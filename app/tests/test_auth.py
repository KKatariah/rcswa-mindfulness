"""Sign-up, login, tokens, lockout, roles and the approval gate."""

from datetime import date, timedelta
from unittest.mock import patch

from django.test import override_settings
from django.utils import timezone
from rest_framework import status

from ..models import AuthToken, Cohort, Enrollment, ForumPost, ForumThread
from ..serializers import ForumPostSerializer
from ..utils import gravatar_url
from .base import User, TestCase, APITestCase, _enroll


class UserAvatarTests(APITestCase):
    def test_user_avatar_url_is_server_generated_from_email(self):
        user = User.objects.create_user(
            email="student@test.local",
            password="testpass",
        )

        self.client.force_login(user)

        resp = self.client.get("/api/user/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["user"]["avatar_url"], gravatar_url(user.email))
        self.assertNotIn("gravatar_url", resp.data["user"])

    def test_deleted_user_avatar_defaults_to_gravatar_mystery_person(self):
        thread = ForumThread.objects.create(
            title="Test thread",
            created_by=None,
        )
        post = ForumPost.objects.create(
            thread=thread,
            author=None,
            body="deleted author",
        )

        serializer = ForumPostSerializer(instance=post)
        self.assertEqual(serializer.data["author_avatar_url"], gravatar_url(""))


class AuthRoleTests(APITestCase):
    def setUp(self):
        self.student = User.objects.create_user(
            email="student@test.local", password="testpass", full_name="Student One",
        )
        _enroll(self.student)

    def test_login_response_includes_role(self):
        resp = self.client.post(
            "/api/login/",
            {"email": "student@test.local", "password": "testpass"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["user"]["role"], "student")

    def test_register_response_includes_role(self):
        resp = self.client.post(
            "/api/register/",
            {"email": "new@test.local", "full_name": "New User", "password": "Calm-River-42"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp.data["user"]["role"], "student")

    def test_register_rejects_weak_passwords(self):
        for password in ["a", "password1", "12345678", "newuser123"]:
            resp = self.client.post(
                "/api/register/",
                {"email": "newuser@test.local", "full_name": "New User", "password": password},
                content_type="application/json",
            )
            self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST, password)
            self.assertIn("password", resp.data)
        self.assertFalse(User.objects.filter(email="newuser@test.local").exists())

    def test_change_password_rejects_weak_password(self):
        self.client.force_login(self.student)
        resp = self.client.post(
            "/api/change-password/",
            {"current_password": "testpass", "new_password": "password1"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("new_password", resp.data)

    def test_login_rate_limited_after_10_attempts(self):
        for _ in range(10):
            resp = self.client.post(
                "/api/login/",
                {"email": "student@test.local", "password": "wrong"},
                content_type="application/json",
            )
            self.assertNotEqual(resp.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        resp = self.client.post(
            "/api/login/",
            {"email": "student@test.local", "password": "testpass"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    def test_current_user_returns_role(self):
        self.client.force_login(self.student)
        resp = self.client.get("/api/user/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["user"]["role"], "student")


class RoleStaffSyncTests(TestCase):
    """User.save() keeps is_staff in step with role."""

    def test_promoting_to_admin_sets_is_staff(self):
        user = User.objects.create_user(email="promote@test.local", password="testpass")
        self.assertFalse(user.is_staff)
        user.role = User.Role.ADMIN
        user.save()
        user.refresh_from_db()
        self.assertTrue(user.is_staff)

    def test_demoting_admin_clears_is_staff(self):
        user = User.objects.create_user(
            email="demote@test.local", password="testpass", role=User.Role.ADMIN,
        )
        self.assertTrue(user.is_staff)
        user.role = User.Role.STUDENT
        user.save()
        user.refresh_from_db()
        self.assertFalse(user.is_staff)

    def test_superuser_is_always_admin(self):
        user = User.objects.create_superuser(email="super@test.local", password="testpass")
        self.assertEqual(user.role, User.Role.ADMIN)
        user.role = User.Role.STUDENT
        user.save()
        user.refresh_from_db()
        self.assertEqual(user.role, User.Role.ADMIN)
        self.assertTrue(user.is_staff)


@override_settings(GOOGLE_CLIENT_ID="test-client")
class GoogleLoginEdgeCaseTests(APITestCase):
    def setUp(self):
        self.existing = User.objects.create_user(email="victim@test.local", password="testpass")

    def _google_login(self, idinfo):
        with patch("app.views.id_token.verify_oauth2_token", return_value=idinfo):
            return self.client.post("/api/google-login/", {"credential": "x"}, content_type="application/json")

    def test_unverified_email_cannot_log_into_existing_account(self):
        resp = self._google_login({"email": "victim@test.local", "email_verified": False, "name": "Attacker"})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertNotIn("token", resp.data)

    def test_google_cannot_take_over_a_password_account(self):
        # Sign-up doesn't verify emails, so whoever set this password may not own the address.
        resp = self._google_login({"email": "Victim@Test.local", "email_verified": True, "name": "Victim"})
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertNotIn("token", resp.data)
        self.assertIn("password", resp.data["error"])

    def test_google_account_logs_in_again_ignoring_case(self):
        google_user = User.objects.create_user(email="g.user@gmail.com", auth_provider="google")
        resp = self._google_login({"email": "G.User@Gmail.com", "email_verified": True, "name": "G"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["user"]["id"], google_user.pk)
        self.assertEqual(User.objects.filter(email__iexact="g.user@gmail.com").count(), 1)

    def test_new_google_user_is_created_lowercase_without_password(self):
        resp = self._google_login({"email": "New.Person@Gmail.com", "email_verified": True, "name": "New"})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        user = User.objects.get(email="new.person@gmail.com")
        self.assertFalse(user.has_usable_password())
        _enroll(user)
        self.client.force_login(user)
        resp = self.client.post(
            "/api/change-password/", {"current_password": "x", "new_password": "Calm-River-42"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Google", resp.data["error"])


class EmailCaseTests(APITestCase):
    def test_register_rejects_same_email_with_different_case(self):
        User.objects.create_user(email="student@test.local", password="testpass")
        resp = self.client.post(
            "/api/register/", {"email": "Student@Test.local", "full_name": "Dup", "password": "Calm-River-42"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("email", resp.data)

    def test_register_stores_lowercase_and_login_ignores_case(self):
        resp = self.client.post(
            "/api/register/", {"email": "Mixed.Case@Test.local", "full_name": "Mixed", "password": "Calm-River-42"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertTrue(User.objects.filter(email="mixed.case@test.local").exists())
        resp = self.client.post(
            "/api/login/", {"email": "MIXED.case@test.LOCAL", "password": "Calm-River-42"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)


class LoginLockoutTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(email="lock@test.local", password="Calm-River-42")

    def _login(self, password, ip="10.0.0.1"):
        return self.client.post(
            "/api/login/", {"email": "Lock@Test.local", "password": password}, format="json", REMOTE_ADDR=ip,
        )

    def test_five_wrong_passwords_lock_the_account(self):
        codes = [self._login("wrong", ip=f"10.0.0.{i}").status_code for i in range(4)]
        self.assertEqual(codes, [401] * 4)
        fifth = self._login("wrong", ip="10.0.0.9")
        self.assertEqual(fifth.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(fifth.data["error"], "Too many failed attempts. Try again in 15 minutes.")
        # Even the right password is refused while locked, from any address.
        locked = self._login("Calm-River-42", ip="10.0.0.99")
        self.assertEqual(locked.status_code, status.HTTP_403_FORBIDDEN)
        self.assertNotIn("token", locked.data)

    def test_lock_expires(self):
        for i in range(5):
            self._login("wrong", ip=f"10.0.1.{i}")
        later = timezone.now() + timedelta(minutes=16)
        with patch("django.utils.timezone.now", return_value=later):
            self.assertEqual(self._login("Calm-River-42", ip="10.0.1.99").status_code, status.HTTP_200_OK)

    def test_successful_login_resets_the_count(self):
        for i in range(4):
            self._login("wrong", ip=f"10.0.2.{i}")
        self.assertEqual(self._login("Calm-River-42", ip="10.0.2.50").status_code, status.HTTP_200_OK)
        self.user.refresh_from_db()
        self.assertEqual(self.user.failed_login_count, 0)
        self.assertEqual(self._login("wrong", ip="10.0.2.60").status_code, status.HTTP_401_UNAUTHORIZED)

    def test_django_admin_login_is_locked_too(self):
        admin = User.objects.create_user(email="boss@test.local", password="Calm-River-42", role=User.Role.ADMIN)
        for _ in range(5):
            self.client.post("/admin/login/", {"username": admin.email, "password": "wrong"})
        resp = self.client.post("/admin/login/", {"username": admin.email, "password": "Calm-River-42"})
        self.assertEqual(resp.status_code, 200)  # the login form again, not a redirect into the admin
        self.assertNotIn("_auth_user_id", self.client.session)


class PerDeviceTokenTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(email="dev@test.local", password="Calm-River-42")
        _enroll(self.user)

    def _token(self, ip):
        resp = self.client.post(
            "/api/login/", {"email": "dev@test.local", "password": "Calm-River-42"}, format="json", REMOTE_ADDR=ip,
        )
        return resp.data["token"]

    def _get_user(self, token):
        return self.client.get("/api/user/", HTTP_AUTHORIZATION=f"Token {token}")

    def test_each_login_gets_its_own_token_and_logout_ends_only_that_one(self):
        from ..models import AuthToken
        phone, laptop = self._token("10.1.0.1"), self._token("10.1.0.2")
        self.assertNotEqual(phone, laptop)
        # Only hashes are stored.
        self.assertFalse(AuthToken.objects.filter(key_hash__in=[phone, laptop]).exists())
        self.client.post("/api/logout/", HTTP_AUTHORIZATION=f"Token {phone}")
        self.assertEqual(self._get_user(phone).status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(self._get_user(laptop).status_code, status.HTTP_200_OK)

    def test_token_expires_after_seven_idle_days_and_use_extends_it(self):
        token = self._token("10.1.1.1")
        start = timezone.now()
        with patch("django.utils.timezone.now", return_value=start + timedelta(days=6)):
            self.assertEqual(self._get_user(token).status_code, status.HTTP_200_OK)
        with patch("django.utils.timezone.now", return_value=start + timedelta(days=12)):
            self.assertEqual(self._get_user(token).status_code, status.HTTP_200_OK)  # 6 idle days since last use
        with patch("django.utils.timezone.now", return_value=start + timedelta(days=20)):
            resp = self._get_user(token)
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertIn("expired", resp.data["detail"])
        self.assertFalse(self.user.auth_tokens.exists())

    def test_password_change_signs_out_every_device(self):
        phone, laptop = self._token("10.1.2.1"), self._token("10.1.2.2")
        resp = self.client.post(
            "/api/change-password/", {"current_password": "Calm-River-42", "new_password": "Quiet-Forest-77"},
            format="json", HTTP_AUTHORIZATION=f"Token {phone}",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(self._get_user(phone).status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(self._get_user(laptop).status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(self._get_user(resp.data["token"]).status_code, status.HTTP_200_OK)


class ApprovalGateTests(APITestCase):
    """Only students with an ACTIVE enrollment (and admins) get past IsApproved."""

    PROTECTED_URLS = (
        "/api/modules/",
        "/api/surveys/",
        "/api/progress/",
        "/api/content-views/",
        "/api/forum/threads/",
        "/api/additional-resources/",
        "/api/program-status/",
        "/api/notifications/preferences/me/",
        "/api/notifications/subscriptions/",
    )

    def setUp(self):
        today = date.today()
        self.cohort = Cohort.objects.create(
            name="Gate Cohort", year=today.year,
            start_date=today - timedelta(days=3), end_date=today + timedelta(days=60),
        )
        self.admin = User.objects.create_user(
            email="admin@test.local", password="testpass", role=User.Role.ADMIN,
        )
        self.student = User.objects.create_user(
            email="pending@test.local", password="testpass", full_name="Pending Person",
        )
        self.enrollment = Enrollment.objects.create(
            user=self.student, cohort=self.cohort, status=Enrollment.Status.PENDING,
        )

    def test_pending_user_blocked_from_protected_endpoints(self):
        self.client.force_login(self.student)
        for url in self.PROTECTED_URLS:
            with self.subTest(url=url):
                resp = self.client.get(url)
                self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
                self.assertIn("awaiting admin approval", str(resp.data["detail"]))

    def test_pending_user_blocked_with_token_auth(self):
        token = AuthToken.issue(self.student)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token}")
        resp = self.client.get("/api/modules/")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
        self.assertIn("awaiting admin approval", str(resp.data["detail"]))

    def test_pending_user_can_check_status_and_log_out(self):
        token = AuthToken.issue(self.student)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token}")
        resp = self.client.get("/api/user/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertFalse(resp.data["user"]["is_approved"])
        self.assertEqual(resp.data["user"]["enrollment_status"], "pending")
        resp = self.client.post("/api/logout/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    def test_pending_user_can_log_in_and_is_told_they_are_unapproved(self):
        resp = self.client.post(
            "/api/login/", {"email": "pending@test.local", "password": "testpass"}, format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertFalse(resp.data["user"]["is_approved"])

    def test_public_module_summary_stays_open_to_pending_user(self):
        self.client.force_login(self.student)
        self.assertEqual(self.client.get("/api/modules/summary/").status_code, status.HTTP_200_OK)

    def test_new_signup_is_unapproved(self):
        resp = self.client.post(
            "/api/register/",
            {"email": "new@test.local", "full_name": "New User", "password": "Calm-River-42"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertFalse(resp.data["user"]["is_approved"])
        self.assertEqual(resp.data["user"]["enrollment_status"], "pending")

    def test_approving_the_enrollment_grants_access(self):
        self.client.force_login(self.student)
        self.assertEqual(self.client.get("/api/modules/").status_code, status.HTTP_403_FORBIDDEN)

        self.client.force_login(self.admin)
        resp = self.client.patch(
            f"/api/enrollments/{self.enrollment.pk}/", {"status": "active"}, format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

        self.client.force_login(self.student)
        self.assertEqual(self.client.get("/api/modules/").status_code, status.HTTP_200_OK)
        self.assertTrue(self.client.get("/api/user/").data["user"]["is_approved"])

    def test_completed_and_withdrawn_enrollments_are_not_approved(self):
        self.client.force_login(self.student)
        for enrollment_status in (Enrollment.Status.COMPLETED, Enrollment.Status.WITHDRAWN):
            with self.subTest(status=enrollment_status):
                Enrollment.objects.filter(pk=self.enrollment.pk).update(status=enrollment_status)
                self.assertEqual(self.client.get("/api/modules/").status_code, status.HTTP_403_FORBIDDEN)
                user = self.client.get("/api/user/").data["user"]
                self.assertFalse(user["is_approved"])
                self.assertEqual(user["enrollment_status"], enrollment_status)

    def test_admin_needs_no_enrollment(self):
        self.client.force_login(self.admin)
        self.assertEqual(self.client.get("/api/modules/").status_code, status.HTTP_200_OK)
        self.assertTrue(self.client.get("/api/user/").data["user"]["is_approved"])

    def test_user_with_no_enrollment_is_unapproved_with_no_status(self):
        loner = User.objects.create_user(email="loner@test.local", password="testpass")
        self.client.force_login(loner)
        self.assertEqual(self.client.get("/api/modules/").status_code, status.HTTP_403_FORBIDDEN)
        user = self.client.get("/api/user/").data["user"]
        self.assertFalse(user["is_approved"])
        self.assertIsNone(user["enrollment_status"])


class LockoutBackendTests(TestCase):
    """LockoutModelBackend called directly, as the Django admin login does."""

    def setUp(self):
        self.user = User.objects.create_user(email="backend@test.local", password="Calm-River-42")

    def _authenticate(self, **credentials):
        from ..lockout import LockoutModelBackend
        return LockoutModelBackend().authenticate(None, **credentials)

    def test_accepts_the_email_by_field_name(self):
        # The admin login form passes `username`; other callers pass the USERNAME_FIELD (email).
        self.assertEqual(self._authenticate(email="backend@test.local", password="Calm-River-42"), self.user)
        self.assertEqual(self._authenticate(username="backend@test.local", password="Calm-River-42"), self.user)

    def test_missing_credentials_are_refused_without_counting(self):
        self.assertIsNone(self._authenticate(password="Calm-River-42"))
        self.assertIsNone(self._authenticate(username="backend@test.local"))
        self.user.refresh_from_db()
        self.assertEqual(self.user.failed_login_count, 0)

    def test_an_unknown_email_is_refused_but_still_hashes_the_password(self):
        # Hashing anyway keeps the response time the same, so it doesn't reveal which emails exist.
        with patch("django.contrib.auth.base_user.AbstractBaseUser.set_password") as set_password:
            self.assertIsNone(self._authenticate(username="nobody@test.local", password="guess"))
        set_password.assert_called_once_with("guess")

    def test_a_deactivated_account_is_refused_even_with_the_right_password(self):
        self.user.is_active = False
        self.user.save()
        self.assertIsNone(self._authenticate(username="backend@test.local", password="Calm-River-42"))
        self.user.refresh_from_db()
        self.assertEqual(self.user.failed_login_count, 1)

    def test_a_locked_account_is_refused_without_checking_the_password(self):
        self.user.locked_until = timezone.now() + timedelta(minutes=5)
        self.user.save()
        with patch.object(User, "check_password") as check:
            self.assertIsNone(self._authenticate(username="backend@test.local", password="Calm-River-42"))
        check.assert_not_called()

    def test_a_good_login_clears_earlier_failures(self):
        self.user.failed_login_count = 3
        self.user.save()
        self._authenticate(username="backend@test.local", password="Calm-River-42")
        self.user.refresh_from_db()
        self.assertEqual(self.user.failed_login_count, 0)
        self.assertIsNone(self.user.locked_until)

    def test_lock_minutes_left_rounds_up_and_ignores_expired_locks(self):
        from ..lockout import lock_minutes_left
        self.assertEqual(lock_minutes_left(self.user), 0)
        self.user.locked_until = timezone.now() + timedelta(minutes=14, seconds=1)
        self.assertEqual(lock_minutes_left(self.user), 15)
        self.user.locked_until = timezone.now() - timedelta(seconds=1)
        self.assertEqual(lock_minutes_left(self.user), 0)
