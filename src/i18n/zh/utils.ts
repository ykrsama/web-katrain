export default {
  'Situational superko: that move repeats an earlier position with the same player to move.':
    '局面禁止全局同形（情境）：该走法重复了之前以同一方落子时的局面。',
  'Positional superko: that move repeats an earlier position.':
    '局面禁止全局同形（位置）：该走法重复了之前的局面。',
  'Human ({profile}) passed, following the engine\'s judgement.':
    '人类棋手（{profile}）选择停手，遵循引擎的判断。',
  'Human ({profile}) played {label}, which players of that rank pick {prob}% of the time.':
    '人类棋手（{profile}）下在 {label}，该段位棋手有 {prob}% 的概率选择此走法。',

  // saveStatusDisplay
  'Unsaved': '未保存',
  'Unsaved changes. Save to Library or download SGF to keep this game permanently.':
    '有未保存的改动。保存到棋库或下载 SGF 以永久保留本局。',
  'Recovery saving': '正在自动保存',
  'Saving': '保存中',
  'Unsaved changes. Updating the recovery copy; save to Library or download SGF for a permanent copy.':
    '有未保存的改动。正在更新恢复副本；保存到棋库或下载 SGF 可获得永久副本。',
  'Recovery saved': '恢复副本已保存',
  'Saved': '已保存',
  'Recovery copy saved at {detail}. This game is still unsaved until you save to Library or download SGF.':
    '恢复副本已于 {detail} 保存。在保存到棋库或下载 SGF 之前，本局仍未保存。',
  'Recovery copy saved. This game is still unsaved until you save to Library or download SGF.':
    '恢复副本已保存。在保存到棋库或下载 SGF 之前，本局仍未保存。',
  'Recovery skipped': '已跳过恢复保存',
  'Too large': '过大',
  'Game is too large for recovery auto-save ({max}). Save to Library or download SGF to keep changes.':
    '本局过大，无法进行恢复自动保存（{max}）。保存到棋库或下载 SGF 以保留改动。',
  'Recovery failed': '恢复保存失败',
  'Save failed': '保存失败',
  'Recovery auto-save failed. Save to Library or download SGF to keep changes.':
    '恢复自动保存失败。保存到棋库或下载 SGF 以保留改动。',

  // importSummary
  'with 1 restored analysis': '含 1 个恢复的分析',
  'with {count} restored analyses': '含 {count} 个恢复的分析',

  // modelDownloadError
  'Download blocked by the browser (CORS). Use "Copy URL" to fetch it yourself, then "Upload Weights".':
    '浏览器阻止了下载（CORS）。请自行使用“复制 URL”获取，然后再“上传权重”。',
  'Download failed.': '下载失败。',

  // gameAnalysisProgress
  'ETA {eta}': '预计还需 {eta}',
  'Game review progress: {caption}': '棋局复盘进度：{caption}',

  // bestMoveSummary
  '{visits} visits': '{visits} 次访问',
  '{prior} policy': '{prior} 策略',
  'Best move {move}': '最佳走法 {move}',
  'candidate {rank}': '候选走法 {rank}',
  '{prior} policy prior': '{prior} 策略先验',
  'score {value}': '目差 {value}',
  'black win {value}': '黑方胜率 {value}',

  // gameInfoText
  'Komi: {value}': '贴目：{value}',
  'Ruleset: {value}': '规则：{value}',

  // gameInfoDisplay
  'Event': '赛事',
  'Date': '日期',
  'Place': '地点',
  'Result': '结果',
  'Time': '时间',
  '{black} vs {white}': '{black} 对 {white}',
  'Black': '黑方',
  'White': '白方',
  'Untitled game': '未命名对局',

  // gamepadLabel
  'Gamepad': '手柄',

  // quickNewGame
  'Quick new game ({size}×{size}): uses your saved defaults and replaces the current game after the unsaved-changes check.':
    '快速新对局（{size}×{size}）：将使用您保存的默认设置，并在未保存改动检查后替换当前对局。',

  // manualScore
  'Jigo': '和棋',

  // pasteSgfInput
  'Paste raw SGF text or an Online-Go game URL. OGS links are downloaded as SGF before loading.':
    '粘贴原始 SGF 文本或 Online-Go 对局链接。OGS 链接在加载前会先下载为 SGF。',
  'Opening SGF...': '正在打开 SGF……',
  'Paste raw SGF text or an Online-Go game URL.': '请粘贴原始 SGF 文本或 Online-Go 对局链接。',
  'Detected SGF content. It will import directly from this text.':
    '检测到 SGF 内容。将直接从此文本导入。',
  'Opening pasted SGF...': '正在打开粘贴的 SGF……',
  'Could not parse this SGF. Check that it starts with (; and contains a complete game tree.':
    '无法解析此 SGF。请检查它是否以 (; 开头并包含完整的棋谱树。',
  'Detected OGS game {gameId}. It will download the public SGF from Online-Go.':
    '检测到 OGS 对局 {gameId}。将下载 Online-Go 的公开 SGF。',
  'Downloading OGS game {gameId}...': '正在下载 OGS 对局 {gameId}……',
  'Could not download or parse OGS game {gameId}. Check that the game is public and the URL looks like online-go.com/game/12345.':
    '无法下载或解析 OGS 对局 {gameId}。请检查对局是否公开、链接是否形如 online-go.com/game/12345。',
  'This looks like a URL. Only Online-Go game links are downloaded; paste raw SGF for other sites.':
    '这看起来像一个链接。只有 Online-Go 对局链接会被下载；其他网站请直接粘贴原始 SGF。',
  'Opening SGF text...': '正在打开 SGF 文本……',
  'Could not parse this as SGF. Paste raw SGF text or an Online-Go game URL.':
    '无法将其解析为 SGF。请粘贴原始 SGF 文本或 Online-Go 对局链接。',
  'This will be parsed as SGF text. SGF usually starts with (;GM[1].':
    '这将按 SGF 文本解析。SGF 通常以 (;GM[1] 开头。',

  // ogs
  'Failed to download OGS game {gameId}: {status}': '无法下载 OGS 对局 {gameId}：{status}',
  'Empty SGF content received from OGS game {gameId}': '从 OGS 对局 {gameId} 收到的 SGF 内容为空',

  // photoBoard
  'JPG, PNG, WebP, or BMP': 'JPG、PNG、WebP 或 BMP',
  'Board photos must be {label}.': '棋盘照片必须是 {label}。',
  'Expected a {size}x{size} board.': '期望得到 {size}×{size} 的棋盘。',
  'Expected {count} intersections for a {size}x{size} board.':
    '对于 {size}×{size} 的棋盘，期望有 {count} 个交叉点。',

  // modelUpload
  'Uploaded weights': '已上传权重',
  'This model is too large for the browser engine ({size} MB). Use the Strong b18 browser weights or another compressed model under {max}.':
    '此模型对浏览器引擎而言过大（{size} MB）。请使用 Strong b18 浏览器权重或其他小于 {max} 的压缩模型。',
  'Unknown size': '大小未知',
  'Use a KataGo .bin.gz weights file.': '请使用 KataGo 的 .bin.gz 权重文件。',

  // downloadProgress
  'Download failed ({status})': '下载失败（{status}）',

  // errorReporting
  'Web KaTrain diagnostics': 'Web KaTrain 诊断信息',
  'Version: {version}': '版本：{version}',
  'Commit: {commit}': '提交：{commit}',
  'Repository: {repository}': '仓库：{repository}',
  'Type: {type}': '类型：{type}',
  'Time: {time}': '时间：{time}',
  'Message: {message}': '消息：{message}',
  'Source: {source}': '来源：{source}',
  'Location: {location}': '位置：{location}',
  'URL: {url}': 'URL：{url}',
  'User agent: {agent}': '浏览器标识：{agent}',
  'React component stack:': 'React 组件堆栈：',
  'Stack:': '堆栈：',
} as Record<string, string>;