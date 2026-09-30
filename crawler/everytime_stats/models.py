"""The private intermediate format is deliberately independent of the DB schema."""
from dataclasses import dataclass
from hashlib import sha256

FIELDS = ("q1", "q2", "q3", "q4", "average", "max_score")
ALL_FIELDS = (*FIELDS, "observed_max")
SCHEMA_VERSION = 1


def digest(data: bytes) -> str:
    return sha256(data).hexdigest()


@dataclass(frozen=True)
class Comment:
    course_index: int
    comment_index: int
    title: str
    instructor: str
    text: str
    file_name: str
    file_sha256: str

    @property
    def pointer(self):
        return f"/{self.course_index}/댓글/{self.comment_index}"

    def source(self):
        return {
            "type": "everytime_offline",
            "file": self.file_name,
            "file_sha256": self.file_sha256,
            "json_pointer": self.pointer,
            "comment_sha256": digest(self.text.encode("utf-8")),
        }


def evidence(text, start, end, rule, **extra):
    assert 0 <= start < end <= len(text)
    return {"start": start, "end": end, "text": text[start:end], "rule": rule, **extra}
