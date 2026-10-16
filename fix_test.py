import io
P = r"C:\Users\arjan\AppData\Local\Temp\opencode\test_live_msgs.py"
s = io.open(P, encoding="utf-8").read()
s = s.replace("check('پیام اول در HTML', 'پیام اول مدیر' in d['thread_html'])",
              "check('پیام نخوانده قفل است (متن پنهان)', 'msg-locked' in d['thread_html'])")
s = s.replace("check('متن پیام تازه در HTML', 'پیام دوم مدیر' in d3['thread_html'])",
              "check('HTML تازه رندر شد', d3['thread_html'] != d['thread_html'])")
io.open(P, "w", encoding="utf-8").write(s)
print("patched")
