# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Ingest policy — one place that decides whether an advertisement becomes an object.

WHY THIS IS A MODULE AND NOT AN `if` STATEMENT
==============================================
The immediate problem is one device: a garage keypad that rotates its private
address every 1.6 seconds. Constant UUID/major/minor, stationary, uninteresting
— and about **54,000 objects a day** from one piece of hardware. No history TTL
holds that back, because the TTL bounds how long an object lives, not how fast
they arrive.

The general problem is the one a commercial site has. A large building contains
hundreds of devices nobody wants to track: staff phones, contractor tags,
digital signage, POS terminals, wireless peripherals. Each costs CPU on every
poll, memory in the cache, bytes in every live_snapshot, and rows in history.
**The cost driver is churn rate, not device count** — a static beacon costs one
object; a fast rotator costs tens of thousands. Ten bad devices can cost more
than ten thousand good ones.

At that scale, a list of individual devices is unmaintainable: you cannot ask a
facilities manager to enumerate MACs that change every second. So the policy
matches on things that DON'T change — the stable beacon identity, the vendor
OUI, an iBeacon UUID across every major/minor — and it is one function so that
every future capability (auto-detected noise candidates, per-site templates,
churn budgets) plugs in here rather than scattering checks through the ingest
path.

TWO RULES THIS MODULE WILL NOT BREAK
====================================
1. **A mask is never a delete.** Nothing is removed, forgotten or rewritten.
   Clear the policy and every device returns on the next poll, with its
   history intact. This is the same promise `excluded_scanners` makes.
2. **Masking is measured.** Every decision increments a counter with a reason,
   so an operator can answer "what is this saving me, and what have I hidden?"
   A silent filter is indistinguishable from a bug.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable

# Actions a rule can take. Deliberately only two for now: the interesting
# question is WHAT to match, not what to do about it, and every additional
# action is a new thing to explain.
ALLOW = "allow"
MASK = "mask"


@dataclass(frozen=True)
class Identity:
    """What is known about an advertiser at the moment of ingest.

    Everything here except `addr` is stable across a MAC rotation, which is the
    whole point: `addr` is the one field a rotating device changes, so it is the
    one field a durable rule must not depend on.
    """

    addr: str = ""            # the MAC being worn right now
    key: str = ""             # stable identity, e.g. "ibeacon:uuid:major:minor"
    uuid: str = ""            # iBeacon UUID, stable across major/minor
    name: str = ""            # advertised/local name, when there is one

    @property
    def oui(self) -> str:
        """Vendor prefix of the current MAC.

        Only meaningful for a PUBLIC address. A resolvable private address has
        random top bits, so its OUI is noise — `matches()` therefore never uses
        the OUI on its own to mask something; a rule must ask for it.
        """
        a = (self.addr or "").upper()
        return a[:8] if len(a) >= 8 else ""


@dataclass(frozen=True)
class Rule:
    """One match → one action, with a reason a human can read back.

    A rule with no match fields matches nothing. That is deliberate: an empty
    rule that matched everything would be a way to silence a whole site by
    accident, and this is exactly the kind of setting that gets pasted between
    installs.
    """

    action: str = MASK
    reason: str = ""
    keys: frozenset = field(default_factory=frozenset)   # exact stable keys
    uuids: frozenset = field(default_factory=frozenset)  # iBeacon UUID, any major/minor
    ouis: frozenset = field(default_factory=frozenset)   # vendor prefix, public MACs
    addrs: frozenset = field(default_factory=frozenset)  # exact MACs, for static devices

    def matches(self, ident: Identity) -> bool:
        if not (self.keys or self.uuids or self.ouis or self.addrs):
            return False
        if self.keys and (ident.key or "").upper() in self.keys:
            return True
        if self.uuids and (ident.uuid or "").upper() in self.uuids:
            return True
        if self.addrs and (ident.addr or "").upper() in self.addrs:
            return True
        if self.ouis and ident.oui and ident.oui in self.ouis:
            return True
        return False


def _upper_set(values: Iterable[Any]) -> frozenset:
    return frozenset(str(v).strip().upper() for v in (values or []) if str(v).strip())


class IngestPolicy:
    """The decision, plus what it cost.

    Built fresh from settings each poll — the same contract `excluded_scanners`
    has, so toggling a rule takes effect on the next snapshot rather than at the
    next restart.
    """

    def __init__(self, rules: list[Rule] | None = None) -> None:
        self.rules: list[Rule] = list(rules or [])
        self.masked: dict[str, int] = {}   # reason → count, this poll

    @classmethod
    def from_settings(cls, data: dict[str, Any] | None) -> "IngestPolicy":
        """Read `excluded_objects` and `ingest_rules` out of the settings dict.

        `excluded_objects` is the simple form — a flat list of stable keys,
        which is what a one-device exclusion writes and what the UI's "ignore
        this device" button produces. `ingest_rules` is the general form. Both
        end up as Rules so there is only ever one thing to evaluate.
        """
        d = data or {}
        rules: list[Rule] = []

        simple = _upper_set(d.get("excluded_objects"))
        if simple:
            rules.append(Rule(action=MASK, reason="excluded by the user", keys=simple))

        for raw in (d.get("ingest_rules") or []):
            if not isinstance(raw, dict):
                continue
            match = raw.get("match") if isinstance(raw.get("match"), dict) else {}
            rule = Rule(
                action=MASK if str(raw.get("action") or MASK) == MASK else ALLOW,
                reason=str(raw.get("reason") or "ingest rule"),
                keys=_upper_set(match.get("keys")),
                uuids=_upper_set(match.get("uuids")),
                ouis=_upper_set(match.get("ouis")),
                addrs=_upper_set(match.get("addrs")),
            )
            # A rule that matches nothing is dropped rather than stored, so the
            # diagnostics count reflects rules that can actually fire.
            if rule.keys or rule.uuids or rule.ouis or rule.addrs:
                rules.append(rule)
        return cls(rules)

    def decide(self, ident: Identity) -> tuple[str, str]:
        """Return (action, reason). First matching rule wins.

        ALLOW rules are honoured and stop evaluation, so a broad mask can be
        given a narrow exception — "mask this whole vendor except the two tags
        we actually issued" — without inverting the whole list.
        """
        for rule in self.rules:
            if rule.matches(ident):
                if rule.action == MASK:
                    self.masked[rule.reason] = self.masked.get(rule.reason, 0) + 1
                return rule.action, rule.reason
        return ALLOW, ""

    def is_masked(self, ident: Identity) -> bool:
        return self.decide(ident)[0] == MASK

    @property
    def active(self) -> bool:
        """True when there is anything to evaluate.

        The ingest path checks this to skip the work entirely on the
        overwhelming majority of installs, which have no rules at all.
        """
        return bool(self.rules)

    def diagnostics(self) -> dict[str, Any]:
        """What was hidden, and why — never a silent filter."""
        return {
            "rules": len(self.rules),
            "masked_total": sum(self.masked.values()),
            "masked_by_reason": dict(sorted(self.masked.items(), key=lambda kv: -kv[1])),
        }
