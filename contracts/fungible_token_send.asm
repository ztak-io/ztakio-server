# This is a contract template to send tokens from one address to another
# It receives 4 parameters
# 1) Token path
# 2) Address to send to
# 3) Amount to send
# 4) Memo to append (can be empty string)
# The called token must have a "send" entrypoint
# The send function must return 1 on success
REQUIRE /hazama/{{{path}}}

# Send
PUSHS "{{{destination}}}"
PUSHI {{{amount}}}
PUSHS "{{{memo}}}"
ECALL /hazama/{{{path}}}:send

END
