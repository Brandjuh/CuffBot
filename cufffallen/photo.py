"""Mirroring a submitted photo, so a memorial does not go blank in four days.

Hotlinking a photo into an embed only works for as long as the link does, and
the links members actually paste are frequently the worst kind. A Facebook CDN
URL is the example that prompted this:

    …/768350885_….png?…&oh=00_AQES…&oe=6A7FCE48

``oe`` is the expiry, hex-encoded — that one was signed on a Monday and dead by
Saturday. It also serves ``image/jpeg`` from a path ending in ``.png``, so the
extension is not to be trusted either. An embed pointed at that URL would look
right in the preview, right at approval, and be an empty grey box in the
memorial channel by the end of the week.

So the bytes are fetched once and uploaded to Discord as an attachment, and the
embed points at ``attachment://…``. An attachment lives as long as the message
does, which for a memorial is the point.

Nothing here trusts the URL: the content type decides the extension, the
download stops itself at the size limit rather than after it, and a failure
returns a sentence a member can act on rather than an exception.
"""

from __future__ import annotations

import asyncio
import io
import logging
from dataclasses import dataclass
from typing import Optional, Tuple

import aiohttp
import discord

log = logging.getLogger("red.cuff-cogs.cufffallen.photo")

#: Hard ceiling regardless of what the guild's own upload limit allows. A
#: memorial portrait is not a 50 MB file, and a member who pastes one should be
#: told so rather than have the bot spend a minute on it.
MAX_PHOTO_BYTES = 8 * 1024 * 1024
FETCH_TIMEOUT_S = 25
CHUNK = 64 * 1024

#: What Discord will actually render inside an embed. SVG is deliberately out —
#: Discord accepts the upload and then shows nothing.
CONTENT_TYPES = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/pjpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
}

#: Self-identifying but Mozilla-shaped, the same compromise ``cuffmemorial``
#: makes: some hosts answer 403 to anything that does not open with the usual
#: token, whatever else the request says.
USER_AGENT = (
    "Mozilla/5.0 (compatible; CuffBot/1.0; +https://github.com/Brandjuh/CuffBot) "
    "memorial-photo-mirror"
)

#: Query parameters that mark a link as signed and short-lived. Only used to
#: explain *why* a photo needs mirroring when the mirror could not be made.
EXPIRING_MARKERS = ("oe=", "oh=", "&ex=", "?ex=", "&is=", "hm=", "x-amz-expires", "expires=")


@dataclass(frozen=True)
class Photo:
    """An image already in memory, ready to be uploaded with a message."""

    data: bytes
    filename: str
    content_type: str

    @property
    def reference(self) -> str:
        """How an embed points at this attachment."""
        return f"attachment://{self.filename}"

    @property
    def size_text(self) -> str:
        return describe_size(len(self.data))

    def as_file(self) -> discord.File:
        """A fresh File per send — a File's buffer is consumed when it is used."""
        return discord.File(io.BytesIO(self.data), filename=self.filename)


def describe_size(count: int) -> str:
    if count >= 1024 * 1024:
        return f"{count / (1024 * 1024):.1f} MB"
    return f"{max(1, count // 1024)} KB"


def looks_expiring(url: Optional[str]) -> bool:
    """Whether a link carries a signature that will stop working.

    Facebook, Discord's own CDN and S3 pre-signed URLs all do this. Worth
    saying out loud when the mirror failed, because "it works when I click it"
    is true and beside the point.
    """
    if not url:
        return False
    lowered = url.lower()
    return any(marker in lowered for marker in EXPIRING_MARKERS)


async def fetch_photo(
    session: aiohttp.ClientSession, url: str, *, limit: int = MAX_PHOTO_BYTES
) -> Tuple[Optional[Photo], Optional[str]]:
    """Download an image. Returns ``(photo, None)`` or ``(None, why not)``.

    The reason is written to be shown to whoever pasted the link, so it says
    what is wrong with *their* link rather than what the exception was.
    """
    if not url:
        return None, None
    try:
        async with session.get(
            url,
            timeout=aiohttp.ClientTimeout(total=FETCH_TIMEOUT_S),
            allow_redirects=True,
        ) as response:
            if response.status != 200:
                return None, f"the server answered `{response.status}`"

            content_type = (response.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            extension = CONTENT_TYPES.get(content_type)
            if extension is None:
                shown = content_type or "nothing"
                return None, (
                    f"that link serves `{shown}`, not an image Discord can show — "
                    "it is probably the page the photo is on, not the photo itself"
                )

            # Believe Content-Length only to refuse early; the read below is
            # what actually enforces the limit, because the header can lie.
            try:
                declared = int(response.headers.get("Content-Length") or 0)
            except ValueError:
                declared = 0
            if declared > limit:
                return None, (
                    f"it is {describe_size(declared)}, over the {describe_size(limit)} limit"
                )

            chunks = []
            total = 0
            async for chunk in response.content.iter_chunked(CHUNK):
                total += len(chunk)
                if total > limit:
                    return None, f"it is over the {describe_size(limit)} limit"
                chunks.append(chunk)

            if not total:
                return None, "the file came back empty"
            return (
                Photo(
                    data=b"".join(chunks),
                    # The URL's own extension is not consulted on purpose: the
                    # link that prompted this ends in .png and serves JPEG.
                    filename=f"fallen-hero.{extension}",
                    content_type=content_type,
                ),
                None,
            )
    except asyncio.TimeoutError:
        return None, f"the download timed out after {FETCH_TIMEOUT_S}s"
    except aiohttp.ClientError as error:
        log.info("cufffallen: photo fetch failed for %s (%s)", url, error)
        return None, "the download failed — the host refused it or the link is broken"
    except Exception as error:  # pragma: no cover — never break a submission over a photo
        log.exception("cufffallen: unexpected photo fetch failure", exc_info=error)
        return None, "the download failed unexpectedly"
