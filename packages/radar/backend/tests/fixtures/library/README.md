# Vendored reference cards

`logical-clocks-lamport.md` is a verbatim copy of the card shipped in
karajan-code's `library/` corpus (v4.9.0, commit `04941ed2`). It is the
format this radar emits, so it is kept here byte for byte and the card
tests assert that parsing and re-rendering it returns the same file.

Do not edit it to make a test pass. If it stops parsing, the source format
drifted, and the change belongs in `app/cards/` — with the copy refreshed
from karajan-code in the same commit.
