# -*- coding: utf-8 -*-
"""Ulauncher File Search: filename search over the plocate index.

Supports English, Chinese filenames, pinyin full spelling and pinyin
initials (e.g. "zfbj" matches 支付报表.xlsx).
"""

import html
import logging
import os
import pickle
import re
import subprocess
import sys
import threading
import time

EXT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(EXT_DIR, 'vendor'))

from ulauncher.api.client.Extension import Extension
from ulauncher.api.client.EventListener import EventListener
from ulauncher.api.shared.event import KeywordQueryEvent
from ulauncher.api.shared.item.ExtensionResultItem import ExtensionResultItem
from ulauncher.api.shared.action.RenderResultListAction import RenderResultListAction
from ulauncher.api.shared.action.OpenAction import OpenAction
from ulauncher.api.shared.action.DoNothingAction import DoNothingAction

logger = logging.getLogger(__name__)

try:
    from pypinyin import lazy_pinyin
    HAS_PINYIN = True
except Exception:  # pragma: no cover - pypinyin missing
    lazy_pinyin = None
    HAS_PINYIN = False
    logger.warning('pypinyin not available, pinyin search disabled')

CJK_RE = re.compile(r'[㐀-䶿一-鿿豈-﫿]')
ALNUM_RE = re.compile(r'^[a-z0-9]+$')
NON_ALNUM_RE = re.compile(r'[^a-z0-9]+')
DB_PATH = os.environ.get('LOCATE_PATH', '/var/lib/plocate/plocate.db')
CACHE_DIR = os.path.expanduser('~/.cache/ulauncher-file-search')
CACHE_FILE = os.path.join(CACHE_DIR, 'pinyin_index.pickle')
REBUILD_MIN_INTERVAL = 60  # seconds between db-change checks triggering rebuild
DEFAULT_ICON = 'images/icon.svg'
MAX_SCAN = 400  # cap of merged candidates before display filtering

# result ranking
RANK_BASENAME = 0
RANK_INITIALS_PREFIX = 1
RANK_INITIALS_SUB = 2
RANK_PINYIN_FULL = 3
RANK_PATH_ONLY = 4


def db_signature():
    """(mtime, size) of the plocate db, None if unavailable."""
    try:
        st = os.stat(DB_PATH)
        return (int(st.st_mtime), st.st_size)
    except OSError:
        return None


class PinyinIndex:
    """In-memory pinyin keys for paths whose basename contains CJK chars.

    Built once from a full plocate dump, cached on disk keyed by db
    signature, rebuilt in the background when the db changes.
    """

    def __init__(self):
        self.entries = []  # list of (path, initials, full_pinyin)
        self.db_sig = None
        self.ready = threading.Event()
        self.lock = threading.Lock()

    def build(self):
        sig = db_signature()
        if sig is None:
            logger.warning('plocate db not found at %s', DB_PATH)
            self.ready.set()
            return
        entries = self._load_cache(sig)
        if entries is None:
            logger.info('building pinyin index from plocate dump...')
            started = time.time()
            entries = self._build_from_plocate()
            logger.info('pinyin index built: %d entries in %.1fs',
                        len(entries), time.time() - started)
            self._save_cache(sig, entries)
        else:
            logger.info('pinyin index loaded from cache: %d entries', len(entries))
        with self.lock:
            self.entries = entries
            self.db_sig = sig
        self.ready.set()

    def _load_cache(self, sig):
        try:
            with open(CACHE_FILE, 'rb') as f:
                cached_sig, entries = pickle.load(f)
            if cached_sig == sig and isinstance(entries, list):
                return entries
        except Exception:
            pass
        return None

    def _save_cache(self, sig, entries):
        try:
            os.makedirs(CACHE_DIR, exist_ok=True)
            tmp = CACHE_FILE + '.tmp'
            with open(tmp, 'wb') as f:
                pickle.dump((sig, entries), f, protocol=4)
            os.replace(tmp, CACHE_FILE)
        except Exception as e:
            logger.warning('failed to save pinyin cache: %s', e)

    def _build_from_plocate(self):
        out = subprocess.run(
            ['plocate', '-0', '--', ''],
            capture_output=True, timeout=300).stdout
        entries = []
        for raw in out.split(b'\0'):
            if not raw:
                continue
            base = raw.rsplit(b'/', 1)[-1]
            try:
                name = base.decode('utf-8')
            except UnicodeDecodeError:
                name = base.decode('utf-8', 'replace')
            if not CJK_RE.search(name):
                continue
            path = raw.decode('utf-8', 'replace')
            stem = os.path.splitext(name)[0] or name
            syll = lazy_pinyin(stem, errors='default')
            full = NON_ALNUM_RE.sub('', ''.join(syll).lower())
            initials = ''.join(s[0] for s in syll if s and s[0].isalnum())
            entries.append((path, initials.lower(), full))
        return entries

    def search(self, q):
        """q: lowercase [a-z0-9]+; returns list of (path, rank)."""
        hits = []
        with self.lock:
            entries = self.entries
        for path, initials, full in entries:
            if initials.startswith(q):
                hits.append((path, RANK_INITIALS_PREFIX))
            elif q in initials:
                hits.append((path, RANK_INITIALS_SUB))
            elif q in full:
                hits.append((path, RANK_PINYIN_FULL))
            if len(hits) >= MAX_SCAN:
                break
        return hits


class FileSearcher:
    """Combines direct plocate substring search with the pinyin index."""

    def __init__(self):
        self.index = PinyinIndex()
        self._build_thread = None
        self._last_build = 0.0
        self.start_build()

    def start_build(self):
        if self._build_thread and self._build_thread.is_alive():
            return
        self._build_thread = threading.Thread(target=self._build, daemon=True)
        self._build_thread.start()

    def _build(self):
        if HAS_PINYIN:
            try:
                self.index.build()
            except Exception:
                logger.exception('pinyin index build failed')
                self.index.ready.set()
        self._last_build = time.time()

    def index_ready(self):
        return (not HAS_PINYIN) or self.index.ready.is_set()

    def maybe_rebuild(self):
        if not HAS_PINYIN:
            return
        if time.time() - self._last_build < REBUILD_MIN_INTERVAL:
            return
        sig = db_signature()
        if sig is not None and sig != self.index.db_sig:
            logger.info('plocate db changed, scheduling pinyin index rebuild')
            self._last_build = time.time()
            self.start_build()

    def search(self, q, max_results, excludes):
        self.maybe_rebuild()
        q_lower = q.lower()
        candidates = {}  # path -> rank

        # 1) direct substring match via plocate (covers EN and CJK input)
        try:
            out = subprocess.run(
                ['plocate', '-i', '-l', str(max_results * 8), '--', q],
                capture_output=True, text=True, timeout=10)
            for line in out.stdout.splitlines():
                if not line:
                    continue
                rank = (RANK_BASENAME
                        if q_lower in os.path.basename(line).lower()
                        else RANK_PATH_ONLY)
                candidates.setdefault(line, rank)
        except Exception as e:
            logger.warning('plocate query failed: %s', e)

        # 2) pinyin match for pure ascii-alnum queries
        if len(q_lower) >= 2 and ALNUM_RE.match(q_lower) and self.index.ready.is_set():
            for path, rank in self.index.search(q_lower):
                if rank < candidates.get(path, 99):
                    candidates[path] = rank

        # 3) filter, sort, limit
        results = []
        ordered = sorted(
            candidates.items(),
            key=lambda kv: (kv[1], len(os.path.basename(kv[0])), kv[0]))
        for path, _rank in ordered:
            if len(results) >= max_results:
                break
            if excludes and any(x in path for x in excludes):
                continue
            if not os.path.lexists(path):
                continue  # stale index entry
            results.append(path)
        return results


_gtk = None
_icon_cache = {}


def _ensure_gtk():
    """Import Gtk/Gio lazily; returns (Gtk, Gio) or False."""
    global _gtk
    if _gtk is None:
        try:
            import gi
            gi.require_version('Gtk', '3.0')
            from gi.repository import Gtk, Gio
            _gtk = (Gtk, Gio)
        except Exception:
            logger.warning('Gtk unavailable, falling back to default icon')
            _gtk = False
    return _gtk


def get_icon(path):
    """Resolve a theme icon file path for the given file/dir."""
    key = '<dir>' if os.path.isdir(path) else os.path.splitext(path)[1].lower()
    if key in _icon_cache:
        return _icon_cache[key]
    icon = DEFAULT_ICON
    libs = _ensure_gtk()
    if libs:
        Gtk, Gio = libs
        try:
            if key == '<dir>':
                names = ['folder']
            else:
                ctype = Gio.content_type_guess(path)[0]
                names = list(Gio.content_type_get_icon(ctype).get_names()) if ctype else []
                names.append('application-x-generic')
            theme = Gtk.IconTheme.get_default()
            for name in names:
                info = theme.lookup_icon(name, 48, Gtk.IconLookupFlags.FORCE_SIZE)
                if info and info.get_filename():
                    icon = info.get_filename()
                    break
        except Exception:
            pass
    if len(_icon_cache) < 500:
        _icon_cache[key] = icon
    return icon


def make_item(path):
    return ExtensionResultItem(
        icon=get_icon(path),
        name=html.escape(os.path.basename(path)),
        description=html.escape(path),
        on_enter=OpenAction(path),
        on_alt_enter=OpenAction(os.path.dirname(path) or '/'),
    )


class KeywordQueryEventListener(EventListener):

    def on_event(self, event, extension):
        query = (event.get_argument() or '').strip()
        if not query:
            return RenderResultListAction([ExtensionResultItem(
                icon=DEFAULT_ICON,
                name='输入文件名、拼音或拼音首字母',
                description='例如: report / 报表 / baobiao / bb — 回车打开,Alt+回车打开所在目录',
                on_enter=DoNothingAction(),
            )])

        try:
            max_results = int(extension.preferences.get('max_results', '10') or 10)
        except ValueError:
            max_results = 10
        max_results = max(1, min(max_results, 50))
        excludes = [s.strip() for s in
                    (extension.preferences.get('exclude_dirs') or '').split(',')
                    if s.strip()]

        paths = extension.searcher.search(query, max_results, excludes)
        if not paths:
            note = ('无匹配结果' if extension.searcher.index_ready()
                    else '无匹配结果(拼音索引仍在构建中,稍后再试)')
            return RenderResultListAction([ExtensionResultItem(
                icon=DEFAULT_ICON,
                name=note,
                description='新文件需先刷新索引: sudo updatedb',
                on_enter=DoNothingAction(),
            )])
        return RenderResultListAction([make_item(p) for p in paths])


class FileSearchExtension(Extension):

    def __init__(self):
        super().__init__()
        self.searcher = FileSearcher()
        self.subscribe(KeywordQueryEvent, KeywordQueryEventListener())


if __name__ == '__main__':
    FileSearchExtension().run()
