# User work lists

Signed-in members can privately mark a work as:

- `want`: 想看
- `watching`: 在看
- `seen`: 已看
- `favorite`: 喜欢
- `avoid`: 避雷
- `needs_review`: 需要复核

Users can create, update and remove their own rows through `/api/user-lists` and browse them at `/me/lists`. A generated `userId:workSlug` key prevents duplicate rows.

Personal lists and notes are not public. Only the list owner and the site owner can read them; ordinary administrators and editors do not receive blanket access to private lists.
