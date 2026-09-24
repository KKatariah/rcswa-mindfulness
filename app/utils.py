import hashlib
from urllib.parse import urlencode

DEFAULT_AVATAR = "https://example.com/static/images/defaultavatar.jpg"

# hash the user's email and return the gravatar URL with the specified size
def gravatar_url(email: str, size: int = 40) -> str:
    email_hash = hashlib.sha256(email.strip().lower().encode("utf-8")).hexdigest()
    params = urlencode({"d": "mp", "s": str(size)})
    return f"https://www.gravatar.com/avatar/{email_hash}?{params}"
