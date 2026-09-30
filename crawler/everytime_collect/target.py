"""Strict observed-course identity, with no discovery or ID enumeration."""
import re

from .raw import ObservationError

COURSE_URL = re.compile(r"https://everytime\.kr/lecture/view/([1-9][0-9]*)(?:\?tab=article)?\Z")


def course_urls(value):
    match = COURSE_URL.fullmatch(value) if isinstance(value, str) else None
    if not match:
        raise ObservationError("Expected an observed HTTPS everytime.kr lecture URL without other parameters")
    base = "https://everytime.kr/lecture/view/" + match[1]
    return base, base + "?tab=article"


def validate_target(target):
    if not isinstance(target, dict) or set(target) != {"url", "title", "instructor"}:
        raise ObservationError("Target requires observed URL, exact title, and exact instructor")
    base, url = course_urls(target["url"])
    if any(not isinstance(target[k], str) or not target[k].strip() for k in ("title", "instructor")):
        raise ObservationError("Expected nonempty target labels")
    return {"url": url, "title": target["title"], "instructor": target["instructor"]}
