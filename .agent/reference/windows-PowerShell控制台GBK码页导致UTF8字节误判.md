# Windows PowerShell 控制台 GBK 码页导致 UTF-8 字节误判（用 Node 严格解码验证）

> 跨项目可复用。适用于：在 Windows 上判断某文件是不是合法 UTF-8 / 中文字节是否损坏。

## 症状

在 PowerShell 5.1 里读文件字节再解码，得到**自相矛盾**的结果：

- `[Text.Encoding]::UTF8.GetString(bytes)` 输出一堆 `�` 或乱码
- 同一份字节用 `[Text.Encoding]::GetEncoding(936).GetString(bytes)` 却解出正常中文（如「蓝牙听歌」）

于是误判「文件是 GBK 编码、中文已损坏」。

## 根因

- PowerShell 5.1 的 **默认控制台/管道码页是 GBK(936)**，`Write-Host` 输出中文时会再按 GBK 转码一次，经工具管道（按 UTF-8 收）就变成乱码或 `�`。
- `[Text.Encoding]::UTF8` 是**有损**解码器，非法字节会静默替换为 `�`，并不抛错——所以「没报错」不能证明「是合法 UTF-8」。
- `Get-Content` 默认按 ANSI（GBK）读，`git show ... | Out-File -Encoding ascii` 会把非 ASCII 变成 `?`。

## 可靠判定法（绕开控制台转码）

**Node 严格解码**（Node 不做控制台码页转码，`toString('utf8')` 会保留 `\ufffd` 标记）：

```js
const b = require('fs').readFileSync('file.json')
const text = b.toString('utf8')
const ok = !text.includes('\ufffd')
JSON.parse(text) // 再验证能解析
```

要点：Node 的 `Buffer.toString('utf8')` 对非法字节会写成 `U+FFFD`，所以**只要字符串里出现 `\ufffd` 就是非法 UTF-8**。之后 `JSON.parse` 能过就是合法 JSON。

也可靠：

- Rust `std::fs::read_to_string`（严格，非法字节直接报错）——宿主解析 manifest 的方式，与 Node 判定一致。
- `[System.Text.Encoding]::GetEncoding(936)` 仅在**确实需要按 GBK 解读**（如老工具生成的 GBK 文件）时显式使用。

## 结论

PowerShell 下的「GBK 解码出中文」不能作为文件是 GBK 的证据；以 Node（或 Rust strict read）判定为准。
