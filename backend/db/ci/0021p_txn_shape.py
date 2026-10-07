#!/usr/bin/env python3
# 0021-P — فحص شكل المعاملة في ملف ptest على مستوى الجمل (مش بحث نصي).
#
# القواعد:
#   • أول جملة BEGIN وآخر جملة ROLLBACK.
#   • مفيش بينهم أي جملة تحكّم معاملات: COMMIT (ومنها COMMIT AND CHAIN) · END · ABORT · ROLLBACK · BEGIN · START
#     · PREPARE (PREPARE TRANSACTION) · SAVEPOINT · RELEASE، ولا كلمة COMMIT في أي حتة في الجملة غير "ON COMMIT".
#   • جملة واحدة بس بترجّع صفوف (SELECT / WITH / VALUES / TABLE / SHOW / EXPLAIN / FETCH أو فيها RETURNING)،
#     وهي اللي قبل ROLLBACK على طول.
#   • مفيش أوامر psql (\set، \g، ...) برّه النصوص.
# التعليقات (-- و /* */ المتداخلة) والنصوص ('...' و E'...') والأسماء "..." وجوه $tag$...$tag$ مابتتحسبش.
#
# الاستخدام:  0021p_txn_shape.py FILE...   |   0021p_txn_shape.py --selftest
import re
import sys

ROW_STARTERS = {"SELECT", "WITH", "VALUES", "TABLE", "SHOW", "EXPLAIN", "FETCH"}
TXN_STARTERS = {"BEGIN", "START", "COMMIT", "END", "ABORT", "ROLLBACK", "PREPARE", "SAVEPOINT", "RELEASE"}
DOLLAR_TAG = re.compile(r"\$([A-Za-z_][A-Za-z_0-9]*)?\$")


class ShapeError(Exception):
    pass


def is_ident(ch):
    return ch.isalnum() or ch in "_$"


def statements(sql):
    """Top-level statements as lists of tokens (words upper-cased; literals replaced by markers)."""
    out = []
    words = []
    i = 0
    n = len(sql)
    while i < n:
        c = sql[i]
        nx = sql[i + 1] if i + 1 < n else ""
        if c == "-" and nx == "-":
            j = sql.find("\n", i)
            i = n if j < 0 else j + 1
            continue
        if c == "/" and nx == "*":
            depth = 1
            i += 2
            while i < n and depth > 0:
                if sql.startswith("/*", i):
                    depth += 1
                    i += 2
                elif sql.startswith("*/", i):
                    depth -= 1
                    i += 2
                else:
                    i += 1
            if depth:
                raise ShapeError("unterminated /* comment")
            continue
        if c == "'":
            esc = i > 0 and sql[i - 1] in "eE" and not (i > 1 and is_ident(sql[i - 2]))
            if esc and words and words[-1] == "E":
                words.pop()
            i += 1
            closed = False
            while i < n:
                if esc and sql[i] == "\\":
                    i += 2
                    continue
                if sql[i] == "'":
                    if i + 1 < n and sql[i + 1] == "'":
                        i += 2
                        continue
                    i += 1
                    closed = True
                    break
                i += 1
            if not closed:
                raise ShapeError("unterminated string literal")
            words.append("<STR>")
            continue
        if c == '"':
            i += 1
            closed = False
            while i < n:
                if sql[i] == '"':
                    if i + 1 < n and sql[i + 1] == '"':
                        i += 2
                        continue
                    i += 1
                    closed = True
                    break
                i += 1
            if not closed:
                raise ShapeError("unterminated quoted identifier")
            words.append("<IDENT>")
            continue
        if c == "$" and not (i > 0 and is_ident(sql[i - 1])):
            m = DOLLAR_TAG.match(sql, i)
            if m:
                tag = m.group(0)
                j = sql.find(tag, m.end())
                if j < 0:
                    raise ShapeError("unterminated dollar quote " + tag)
                i = j + len(tag)
                words.append("<DOLLAR>")
                continue
        if c == "\\":
            words.append("<PSQL_META>")
            j = sql.find("\n", i)
            i = n if j < 0 else j + 1
            continue
        if c == ";":
            if words:
                out.append(words)
            words = []
            i += 1
            continue
        if c.isalpha() or c == "_":
            j = i
            while j < n and is_ident(sql[j]):
                j += 1
            words.append(sql[i:j].upper())
            i = j
            continue
        if c.isspace():
            i += 1
            continue
        words.append(c)
        i += 1
    if words:
        out.append(words)
    return out


def returns_rows(words):
    return words[0] in ROW_STARTERS or "RETURNING" in words


def check(sql):
    try:
        stmts = statements(sql)
    except ShapeError as e:
        return [str(e)]
    errors = []
    if not stmts:
        return ["no statements"]
    if stmts[0] != ["BEGIN"]:
        errors.append("first statement must be BEGIN, got: " + " ".join(stmts[0][:6]))
    if stmts[-1] != ["ROLLBACK"]:
        errors.append("last statement must be ROLLBACK, got: " + " ".join(stmts[-1][:6]))
    rows = []
    for k, w in enumerate(stmts):
        text = " ".join(w[:8])
        if "<PSQL_META>" in w:
            errors.append("statement %d: psql meta-command outside literals: %s" % (k + 1, text))
        if 0 < k < len(stmts) - 1 and w[0] in TXN_STARTERS:
            errors.append("statement %d: transaction control in the middle: %s" % (k + 1, text))
        for p, t in enumerate(w):
            # COMMIT كأول كلمة اتمسك فوق (أول/آخر/وسط). هنا: COMMIT جوه جملة ومش جزء من ON COMMIT.
            if t == "COMMIT" and p > 0 and w[p - 1] != "ON":
                errors.append("statement %d: COMMIT outside ON COMMIT: %s" % (k + 1, text))
            if t == "PREPARE" and p > 0 and p + 1 < len(w) and w[p + 1] == "TRANSACTION":
                errors.append("statement %d: PREPARE TRANSACTION: %s" % (k + 1, text))
        if returns_rows(w):
            rows.append(k)
    if len(rows) != 1:
        errors.append("expected exactly one row-returning statement, found %d at %s"
                      % (len(rows), [r + 1 for r in rows]))
    elif rows[0] != len(stmts) - 2:
        errors.append("the row-returning statement must come right before ROLLBACK (it is statement %d of %d)"
                      % (rows[0] + 1, len(stmts)))
    return errors


GOOD = r"""-- header: begin; commit; select 1;
begin;
set local idle_in_transaction_session_timeout = '15s';
set local zell.ptest_profile = 'production';
create temporary table zt_results (n serial, detail text) on commit drop;
create temporary table zt_more (a int) ON   COMMIT
  DROP;
/* commit; /* nested: end; rollback; */ select 2; */
do $zt$
begin
  -- commit; end; rollback;
  execute 'select 1; commit';
  perform 1;
end
$zt$;
create function pg_temp.f() returns text language sql as $f$ select 'commit;' $f$;
do $outer$ begin perform $$ rollback; $$; end $outer$;
insert into zt_results (detail) values ('a;b'), (E'it\'s; commit;'), ($q$ end; $q$);
update zt_results set detail = 'x' where n = 0;
with r as (select n, "end" from (select 1 as n, 2 as "end") s)
select n, 'rollback;' as note from r
union all select 0, 'commit' order by 1;
rollback;
"""


def variant(insert=None, drop_first=False, replace=None, append_before_last=None):
    lines = GOOD.split("\n")
    if drop_first:
        lines = [l for l in lines if l != "begin;"]
    if insert is not None:
        lines.insert(3, insert)
    if append_before_last is not None:
        idx = len(lines) - 1 - lines[::-1].index("rollback;")
        lines.insert(idx, append_before_last)
    text = "\n".join(lines)
    if replace is not None:
        text = text.replace(replace[0], replace[1])
    return text


def selftest():
    cases = [
        ("good file", GOOD, True),
        ("upper case BEGIN / ROLLBACK", GOOD.replace("\nbegin;", "\nBEGIN ;").replace("\nrollback;", "\nROLLBACK;"), True),
        ("missing begin", variant(drop_first=True), False),
        ("ends with commit", variant(replace=("\nrollback;\n", "\ncommit;\n")), False),
        ("ends with end", variant(replace=("\nrollback;\n", "\nend;\n")), False),
        ("no final rollback", variant(replace=("\nrollback;\n", "\n")), False),
        ("commit in the middle", variant(insert="commit;"), False),
        ("commit and chain", variant(insert="commit and chain;"), False),
        ("end in the middle", variant(insert="end;"), False),
        ("abort in the middle", variant(insert="abort;"), False),
        ("prepare transaction", variant(insert="prepare transaction 'zt';"), False),
        ("extra begin", variant(insert="begin;"), False),
        ("start transaction", variant(insert="start transaction;"), False),
        ("rollback in the middle", variant(insert="rollback;"), False),
        ("savepoint", variant(insert="savepoint s1;"), False),
        ("old style select set_config", variant(insert="select pg_catalog.set_config('zell.ptest_profile', 'ci', true);"), False),
        ("second select", variant(insert="select 1;"), False),
        ("values statement", variant(insert="values (1);"), False),
        ("returning", variant(insert="delete from zt_results returning n;"), False),
        ("statement between select and rollback", variant(append_before_last="set local zell.x = '1';"), False),
        ("psql meta-command", variant(insert="\\set ON_ERROR_STOP off"), False),
        ("unterminated dollar quote", variant(insert="do $a$ begin perform 1; end $b$;"), False),
        ("unterminated string", variant(insert="select 'oops;"), False),
    ]
    bad = 0
    for name, sql, should_pass in cases:
        errs = check(sql)
        ok = (not errs) == should_pass
        print("SELFTEST %s %s%s" % ("PASS" if ok else "FAIL", name, "" if ok else " :: " + "; ".join(errs)))
        if not ok:
            bad += 1
    print("TXN_SHAPE_SELFTEST cases=%d fail=%d" % (len(cases), bad))
    return 0 if bad == 0 else 1


def main(argv):
    if argv == ["--selftest"]:
        return selftest()
    if not argv:
        print("usage: 0021p_txn_shape.py FILE... | --selftest", file=sys.stderr)
        return 2
    rc = 0
    for path in argv:
        with open(path, encoding="utf-8") as fh:
            sql = fh.read()
        errs = check(sql)
        if errs:
            rc = 1
            for e in errs:
                print("TXN_SHAPE FAIL %s :: %s" % (path, e))
        else:
            print("TXN_SHAPE OK %s statements=%d" % (path, len(statements(sql))))
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
