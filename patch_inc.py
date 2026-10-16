import io, re
P = r"D:\Application\Fish-Dastmozd\users\templates\users\message_center.html"
s = io.open(P, encoding="utf-8", newline="").read()
pat = re.compile(r"\{% for m in thread %\}.*?\{% endfor %\}", re.S)
n = len(pat.findall(s))
print("for-blocks found:", n)
if n == 1:
    s = pat.sub("{% include 'users/_thread.html' %}", s, count=1)
    io.open(P, "w", encoding="utf-8", newline="").write(s)
    print("replaced with include")
