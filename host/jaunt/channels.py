"""The update-channel contract as the host applies it (docs/UPDATES.md#update-channels).

A reimplementation of scripts/update_channels.py, which the wheel does not ship;
tests/test_update_channels.py proves both agree with tests/fixtures/update_channels.json.
"""
from __future__ import annotations
import re

PREFIX = {"host": "v", "desktop": "desktop-v", "android": "android-v"}
RESERVED = {"main", "beta"}
DEV = r"[a-z][a-z0-9]{0,31}"
COUNT = r"[1-9][0-9]{0,5}"
NAME = re.compile(rf"{DEV}(?:_{COUNT})?")
PRODUCTION = re.compile(r"(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?")
CANDIDATE = re.compile(rf"(\d+)\.(\d+)\.(\d+)-(alpha|beta|rc)\.(\d+)\.ch\.({DEV})\.({COUNT})\.({COUNT})")
PEP = re.compile(rf"(\d+)\.(\d+)\.(\d+)(?:(a|b|rc)(\d+))?(?:\+ch\.({DEV})\.({COUNT})\.({COUNT}))?")
STAGE = {"alpha": 0, "beta": 1, "rc": 2, None: 3}
PEP_STAGE = {"alpha": "a", "beta": "b", "rc": "rc"}
SOURCE = re.compile(r"[0-9a-f]{40}")
DOCUMENT = {"host": "release", "desktop": "desktopRelease", "android": "androidRelease"}


class NotComparable(ValueError):
    """Two versions from different channels or components: no automatic order exists."""


def valid_name(name) -> bool:
    return isinstance(name, str) and NAME.fullmatch(name) is not None


def publishable(name) -> bool:
    return valid_name(name) and "_" in name and name.split("_")[0] not in RESERVED


def parse(tag) -> dict:
    """Component, production key, base tag and optional channel of a release tag."""
    for component, prefix in PREFIX.items():
        if not isinstance(tag, str) or not tag.startswith(prefix):
            continue
        rest = tag[len(prefix):]
        match = PRODUCTION.fullmatch(rest)
        if match:
            major, minor, patch, stage, number = match.groups()
            return {"component": component, "key": (int(major), int(minor), int(patch), STAGE[stage], int(number or 0)),
                    "base": tag, "channel": None, "n": 0}
        match = CANDIDATE.fullmatch(rest)
        if match and match[6] not in RESERVED:
            major, minor, patch, stage, number, dev, pr, n = match.groups()
            return {"component": component, "key": (int(major), int(minor), int(patch), STAGE[stage], int(number)),
                    "base": f"{prefix}{major}.{minor}.{patch}-{stage}.{number}", "channel": f"{dev}_{pr}", "n": int(n)}
        break
    raise ValueError("Unsupported release version")


def python_version(tag: str) -> str:
    """PEP 440 runtime version of a host tag; a candidate is a local version."""
    info = parse(tag)
    if info["component"] != "host":
        raise ValueError("Not a host release")
    major, minor, patch, stage, number = PRODUCTION.fullmatch(info["base"][1:]).groups()
    version = f"{major}.{minor}.{patch}" + (f"{PEP_STAGE[stage]}{number}" if stage else "")
    if info["channel"]:
        dev, pr = info["channel"].split("_")
        version += f"+ch.{dev}.{pr}.{info['n']}"
    return version


def host_tag(version: str) -> str:
    """Release tag of a PEP 440 runtime version, the inverse of python_version."""
    match = PEP.fullmatch(version or "")
    if not match:
        raise ValueError("Unsupported runtime version")
    major, minor, patch, stage, number, dev, pr, n = match.groups()
    tag = f"v{major}.{minor}.{patch}" + ({"a": "-alpha.", "b": "-beta.", "rc": "-rc."}[stage] + number if stage else "")
    if dev:
        tag += f".ch.{dev}.{pr}.{n}"
    parse(tag)
    return tag


def compare(a: str, b: str) -> int:
    """-1, 0 or 1; raises NotComparable across components or between two channels."""
    x, y = parse(a), parse(b)
    if x["component"] != y["component"] or (x["channel"] and y["channel"] and x["channel"] != y["channel"]):
        raise NotComparable(f"{a} and {b} are not ordered")
    left = (x["key"], 1 if x["channel"] else 0, x["n"])
    right = (y["key"], 1 if y["channel"] else 0, y["n"])
    return (left > right) - (left < right)


def automatic(channel: str, current: str, target: str) -> bool:
    """Whether a check that is not a channel switch may install `target` over `current`."""
    x, y = parse(current), parse(target)
    if x["component"] != y["component"]:
        return False
    if channel == "main":
        return y["channel"] is None and compare(current, target) < 0
    return x["channel"] == y["channel"] == channel and compare(current, target) < 0


def validate_document(document, name: str, page: str, repository: str) -> dict:
    """Check a fetched ch/<name>/config.json against the requested name and the official installation.

    The Page is compared without its trailing slash: installation.json stores it
    stripped while config.json publishes it with one, and both name the same URL.
    """
    if not publishable(name):
        raise ValueError("Reserved or invalid channel name has no channel document")
    if not isinstance(document, dict) or document.get("version") != 1 or document.get("channel") != name:
        raise ValueError("Channel document does not describe the requested channel")
    if not isinstance(document.get("page"), str) or document["page"].rstrip("/") != page.rstrip("/") \
            or document.get("repository") != repository:
        raise ValueError("Channel document is not from the official Page and repository")
    if not isinstance(document.get("releaseSource"), str) or not SOURCE.fullmatch(document["releaseSource"]):
        raise ValueError("Channel document has no verified release source")
    counts = set()
    for component, field in DOCUMENT.items():
        info = parse(document.get(field))
        if info["component"] != component or info["channel"] != name:
            raise ValueError(f"{field} is not a {component} candidate of {name}")
        counts.add(info["n"])
    if len(counts) != 1:
        raise ValueError("Channel components come from different candidates")
    return document
