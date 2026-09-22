from types import SimpleNamespace
import pytest
from jaunt.daemon import Host

def test_service_has_distinct_identity_and_still_requires_enabled_policy():
    h=SimpleNamespace(policy=SimpleNamespace(enabled=True),RUNTIME_NAMES=Host.RUNTIME_NAMES)
    assert Host._caller(h,{'runtime':'resetdeck','service':'resetdeck'})==('service:resetdeck','resetdeck')
    with pytest.raises(ValueError):Host._caller(h,{'runtime':'resetdeck'})
    h.policy.enabled=False
    with pytest.raises(ValueError):Host._caller(h,{'runtime':'resetdeck','service':'resetdeck'})

@pytest.mark.asyncio
async def test_service_cannot_type_or_open_shells():
    h=SimpleNamespace(_caller=lambda p:('service:resetdeck','resetdeck'))
    for method in ('agents.type','agents.shell','agents.output'):
        with pytest.raises(ValueError):await Host.agents_gateway(h,method,{})

@pytest.mark.asyncio
async def test_collector_rule_cannot_be_used_for_shell_injection():
    h=SimpleNamespace(_requester_of=lambda peer,p:('device:resetdeck','ResetDeck'))
    for command in ('/usr/bin/python3 /collector/agent.py exchange QQ==;id', '/usr/bin/python3 /collector/agent.py exchange $(id)', '/usr/bin/python3 /collector/agent.py shell QQ=='):
        with pytest.raises(ValueError):await Host.agent_run(h,None,{'runtime':'resetdeck','command':command})
