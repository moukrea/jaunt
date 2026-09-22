"""CLI parsing regressions, using synthetic IDs and no running host."""
import argparse
import json

import pytest

from jaunt import cli


@pytest.fixture(autouse=True)
def isolated_cli(monkeypatch, tmp_path):
    monkeypatch.setenv('jaunt_STATE', str(tmp_path))
    monkeypatch.setenv('jaunt_LANGUAGE', 'en')
    monkeypatch.setenv('jaunt_SESSION_ID', 'synthetic-session')
    monkeypatch.setattr(argparse, '_', lambda text: text)


@pytest.mark.parametrize('command,field', [
    (['unlink'], 'room'), (['revoke'], 'id'),
    (['agents', 'cut'], 'target'), (['notify'], 'title'),
])
@pytest.mark.parametrize('value', [
    'ordinary', '-synthetic_identifier', '--synthetic_identifier',
    '-hSynthetic_identifier', '-device:codex', '-', '-- fini', '--typo',
])
def test_dash_values(command, field, value):
    assert getattr(cli.build_parser().parse_args([*command, value]), field) == value


@pytest.mark.parametrize('argv', [
    ['agents', 'allow', '-request', '--trust', '1h'],
    ['agents', '--trust', '1h', 'allow', '-request'],
])
def test_options_before_and_after_target(argv):
    args = cli.build_parser().parse_args(argv)
    assert (args.target, args.trust) == ('-request', '1h')


def test_options_and_abbreviations():
    args = cli.build_parser().parse_args([
        'agents', 'rule', '-device:codex', '--right=exec', '--patter', '-x', '--remove',
    ])
    assert (args.target, args.right, args.pattern, args.remove) == ('-device:codex', 'exec', '-x', True)


@pytest.mark.parametrize('value', ['--help', '--he', '-h', '--', '--body'])
def test_explicit_delimiter_preserves_colliding_titles(value):
    args = cli.build_parser().parse_args(['notify', '--body', 'details', '--', value])
    assert (args.title, args.body) == (value, 'details')


@pytest.mark.parametrize('argv,field,value', [
    (['unlink', '--', '--help'], 'room', '--help'),
    (['revoke', '--', '-h'], 'id', '-h'),
    (['agents', '--trust', '1h', 'allow', '--', '--trust'], 'target', '--trust'),
    (['notify', '-title', '--body', '-text'], 'body', '-text'),
    (['notify', '-title', '--body=--help'], 'body', '--help'),
    (['agents', 'rule', '-device', '--pattern=--remove'], 'pattern', '--remove'),
])
def test_delimiters_and_option_values(argv, field, value):
    assert getattr(cli.build_parser().parse_args(argv), field) == value


@pytest.mark.parametrize('command', ['unlink', 'revoke', 'agents', 'notify'])
@pytest.mark.parametrize('option', ['-h', '--help', '--he'])
def test_help_still_exits_successfully(command, option, capsys):
    with pytest.raises(SystemExit) as exc:
        cli.build_parser().parse_args([command, option])
    assert exc.value.code == 0
    assert 'usage:' in capsys.readouterr().out


@pytest.mark.parametrize('argv', [
    ['unlink'], ['revoke'], ['notify'], ['agents'],
    ['unlink', '-room', 'extra'], ['notify', '-title', '--boddy'],
    ['agents', 'cut', '-session', 'extra'], ['agents', 'unknown'],
    ['agents', 'allow', '-request', '--trust', 'invalid'],
    ['notify', '-title', '--body', '--session', 's'],
    ['notify', '--body'], ['agents', 'rule', '-device', '--r'],
    ['language', 'xx'], ['service', 'invalid'], ['bridge-hook', 'invalid'],
    ['status', '--typo'], ['init', '--typo'], ['gui', '--typo'],
    ['link', 'synthetic-code', '--typo'], ['--typo', 'status'],
])
def test_invalid_arguments_still_fail(argv):
    with pytest.raises(SystemExit) as exc:
        cli.build_parser().parse_args(argv)
    assert exc.value.code == 2


@pytest.mark.parametrize('argv,method,params,result', [
    (['unlink', '-synthetic-room'], 'links.remove', {'room': '-synthetic-room'}, {'links': []}),
    (['revoke', '--synthetic-device'], 'revoke', {'id': '--synthetic-device'}, {}),
    (['agents', 'cut', '-hSyntheticSession'], 'agents.cut', {'session': '-hSyntheticSession'}, {'log': [{}]}),
    (['agents', 'allow', '-request', '--trust', '1h'], 'agents.decide', {'id': '-request', 'decision': '1h'}, {}),
    (['notify', '-titre', '--body', '-texte'], 'notify',
     {'title': '-titre', 'body': '-texte', 'session': 'synthetic-session'}, {}),
])
def test_main_passes_exact_values_to_control(monkeypatch, capsys, argv, method, params, result):
    calls = []
    monkeypatch.setattr(cli.sys, 'argv', ['jaunt', *argv])
    monkeypatch.setattr(cli, 'control', lambda m, p: calls.append((m, p)) or result)
    cli.main()
    assert calls == [(method, params)]
    json.loads(capsys.readouterr().out)


def test_language_is_configured_before_parser_construction(monkeypatch, capsys):
    configured = []
    monkeypatch.setattr(cli.sys, 'argv', ['jaunt', '--language', 'fr', '--help'])
    monkeypatch.setattr(cli, 'configure_language', lambda value: configured.append(value))

    def translate(text, *values):
        assert configured == ['fr']
        return 'DESCRIPTION TRADUITE' if text == 'Your own shell. Anywhere.' else text

    monkeypatch.setattr(cli, 'tr', translate)
    with pytest.raises(SystemExit) as exc:
        cli.main()
    assert exc.value.code == 0
    assert 'DESCRIPTION TRADUITE' in capsys.readouterr().out


def test_run_forwards_arguments_after_delimiter(monkeypatch):
    commands = []
    monkeypatch.setattr(cli.sys, 'argv', ['jaunt', 'run', '--', 'echo', '--help', '-x'])
    monkeypatch.setattr(cli.subprocess, 'call', lambda argv: commands.append(argv) or 0)
    monkeypatch.setattr(cli, 'control', lambda *args: {})
    with pytest.raises(SystemExit) as exc:
        cli.main()
    assert exc.value.code == 0
    assert commands == [['echo', '--help', '-x']]
