# -*- coding: utf-8 -*-
"""Standalone logic test for the file-search extension (no Ulauncher needed).

Run: uv run --no-project python test_logic.py
Stubs the ulauncher.api modules so main.py can be imported directly.
"""

import os
import sys
import types
from unittest import mock

EXT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, EXT_DIR)


def _stub_ulauncher():
    """Create fake ulauncher.api modules with the classes main.py imports."""
    pkg = types.ModuleType('ulauncher')
    modules = {
        'ulauncher.api': types.ModuleType('ulauncher.api'),
        'ulauncher.api.client': types.ModuleType('ulauncher.api.client'),
        'ulauncher.api.client.Extension': types.ModuleType('ulauncher.api.client.Extension'),
        'ulauncher.api.client.EventListener': types.ModuleType('ulauncher.api.client.EventListener'),
        'ulauncher.api.shared': types.ModuleType('ulauncher.api.shared'),
        'ulauncher.api.shared.event': types.ModuleType('ulauncher.api.shared.event'),
        'ulauncher.api.shared.item': types.ModuleType('ulauncher.api.shared.item'),
        'ulauncher.api.shared.item.ExtensionResultItem': types.ModuleType('ulauncher.api.shared.item.ExtensionResultItem'),
        'ulauncher.api.shared.action': types.ModuleType('ulauncher.api.shared.action'),
        'ulauncher.api.shared.action.RenderResultListAction': types.ModuleType('ulauncher.api.shared.action.RenderResultListAction'),
        'ulauncher.api.shared.action.OpenAction': types.ModuleType('ulauncher.api.shared.action.OpenAction'),
        'ulauncher.api.shared.action.DoNothingAction': types.ModuleType('ulauncher.api.shared.action.DoNothingAction'),
    }

    class Extension:
        def __init__(self):
            self.preferences = {}

        def subscribe(self, *a):
            pass

        def run(self):
            pass

    class EventListener:
        def on_event(self, event, extension):
            raise NotImplementedError

    class KeywordQueryEvent:
        def __init__(self, arg=''):
            self._arg = arg

        def get_argument(self):
            return self._arg

    class ExtensionResultItem:
        def __init__(self, **kw):
            self.kw = kw

        def __repr__(self):
            return 'Item(%s | %s)' % (self.kw.get('name'), self.kw.get('description'))

    class RenderResultListAction(list):
        pass

    class OpenAction:
        def __init__(self, path):
            self.path = path

        def __repr__(self):
            return 'Open(%s)' % self.path

    class DoNothingAction:
        pass

    modules['ulauncher.api.client.Extension'].Extension = Extension
    modules['ulauncher.api.client.EventListener'].EventListener = EventListener
    modules['ulauncher.api.shared.event'].KeywordQueryEvent = KeywordQueryEvent
    modules['ulauncher.api.shared.item.ExtensionResultItem'].ExtensionResultItem = ExtensionResultItem
    modules['ulauncher.api.shared.action.RenderResultListAction'].RenderResultListAction = RenderResultListAction
    modules['ulauncher.api.shared.action.OpenAction'].OpenAction = OpenAction
    modules['ulauncher.api.shared.action.DoNothingAction'].DoNothingAction = DoNothingAction

    for name, mod in modules.items():
        sys.modules[name] = mod
    sys.modules['ulauncher'] = pkg
    return KeywordQueryEvent


KeywordQueryEvent = _stub_ulauncher()
import main  # noqa: E402

failures = []


def check(label, cond, detail=''):
    status = 'PASS' if cond else 'FAIL'
    print('[%s] %s %s' % (status, label, detail))
    if not cond:
        failures.append(label)


def main_test():
    print('HAS_PINYIN =', main.HAS_PINYIN)
    check('pypinyin vendored', main.HAS_PINYIN)

    searcher = main.FileSearcher()
    ok = searcher.index.ready.wait(timeout=300)
    check('pinyin index ready', ok)
    n = len(searcher.index.entries)
    print('CJK entries indexed:', n)
    check('index non-empty', n > 0, '(%d entries)' % n)

    # 1) direct english/cjk substring search through the listener
    ext = main.FileSearchExtension.__new__(main.FileSearchExtension)
    ext.preferences = {'max_results': '10', 'exclude_dirs': ''}
    ext.searcher = searcher
    listener = main.KeywordQueryEventListener()

    res = listener.on_event(KeywordQueryEvent('manifest.json'), ext)
    names = [it.kw['name'] for it in res]
    print('query "manifest.json" ->', names[:3])
    check('direct search hits', any('manifest.json' in x for x in names))

    # empty query hint
    res = listener.on_event(KeywordQueryEvent(''), ext)
    check('empty query hint', len(res) == 1 and '输入' in res[0].kw['name'])

    # 2) pinyin initials: derive a query from a real indexed CJK file
    sample = None
    for path, initials, full in searcher.index.entries:
        if len(initials) >= 4 and os.path.lexists(path):
            sample = (path, initials, full)
            break
    check('found CJK sample', sample is not None)
    if sample:
        path, initials, full = sample
        print('sample CJK file:', path, '| initials:', initials, '| full:', full)
        # query via searcher with a generous limit: pinyin hits rank below
        # direct basename matches, so top-10 may legitimately exclude them
        paths = searcher.search(initials, 50, [])
        print('query "%s" ->' % initials, paths[:3])
        check('pinyin initials search', path in paths)

        if len(full) >= 4:
            paths = searcher.search(full, 50, [])
            print('query "%s" ->' % full, paths[:3])
            check('pinyin full search', path in paths)

    # 3) actions wired correctly
    if sample:
        res = listener.on_event(KeywordQueryEvent(initials), ext)
        item = res[0]
        check('enter opens file', isinstance(item.kw['on_enter'], sys.modules[
            'ulauncher.api.shared.action.OpenAction'].OpenAction))
        check('alt-enter opens dir', item.kw['on_alt_enter'].path == os.path.dirname(item.kw['on_enter'].path))

    print()
    if failures:
        print('FAILED:', failures)
        sys.exit(1)
    print('ALL TESTS PASSED')


if __name__ == '__main__':
    main_test()
