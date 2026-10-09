"""API serializers, one module per area. Everything is re-exported here, so
`from app.serializers import X` keeps working."""

# Unlock rules live in app.access; re-exported for existing imports.
from ..access import module_is_unlocked, module_unlock_date  # noqa: F401
from .users import (  # noqa: F401
    RegisterSerializer,
    UserDisplayNameSerializer,
    AdminUserSerializer,
    AdminUserUpdateSerializer,
    ChangePasswordSerializer,
)
from .cohorts import (  # noqa: F401
    CohortSerializer,
    EnrollmentSerializer,
)
from .content import (  # noqa: F401
    AdditionalResourceSerializer,
    ContentItemSerializer,
    ModuleSerializer,
    ModuleSummarySerializer,
    ContentCompletionSerializer,
    ContentViewSerializer,
    COVER_IMAGE_MAX_BYTES,
)
from .forum import (  # noqa: F401
    ForumPostCreateSerializer,
    ForumPostSerializer,
    ForumThreadSerializer,
    ForumThreadDetailSerializer,
    ForumThreadCreateSerializer,
    ForumFlagCreateSerializer,
    ModeratedPostSerializer,
    ReportedPostSerializer,
    FORUM_POST_MAX_CHARS,
)
from .surveys import (  # noqa: F401
    SurveySerializer,
    SurveyDetailSerializer,
    SurveyResponseSerializer,
    SurveyResponseUpdateSerializer,
    validate_survey_questions,
    SurveyAdminSerializer,
    SurveyResponseAdminSerializer,
    LONGTEXT_MAX_CHARS,
    SURVEY_QUESTION_TYPES,
    SURVEY_QUESTION_ID_RE,
    SURVEY_MAX_QUESTIONS,
    SURVEY_CODE_RE,
)
from .notifications import (  # noqa: F401
    PushSubscriptionSerializer,
    NotificationPreferenceSerializer,
    NotificationLogSerializer,
)
