# language: zh-CN
#
# issue #6：双击 .md 冷启动不自动加载，需二次点击
#
# 根因（2026-10-08 定位）：Windows 冷启动 argv 路径靠 setup 里
# sleep 500ms 后 emit open-file-from-args 投递；前端 listener 晚于
# 500ms 注册时事件丢失，文件不加载。第二次双击走 single-instance
# 转发（此时 listener 已就绪）→ 表现为「二次点击才加载」。
#
# 修复：冷启动 argv 与 macOS RunEvent::Opened 同构——推入
# pending_open_paths 缓冲，前端 init 时 take_pending_open_files
# 排空，不再依赖任何时序假设。
#
# 可执行规格：src-tauri/tests/pending_open_args_test.rs
# （#[path] include 纯逻辑模块），场景名即测试名。

功能: 冷启动命令行打开文件
  作为 Windows 桌面用户
  我希望双击 .md 冷启动应用后文件自动加载
  即使前端事件监听尚未注册

  场景: argv 中的 .md 路径进入待打开缓冲
    假如 命令行为 app.exe C:\docs\note.md
    当 冷启动提取待打开路径
    那么 缓冲中应包含 C:\docs\note.md

  场景: argv[0] 程序自身路径被跳过
    假如 命令行为 app.exe（无文件参数）
    当 冷启动提取待打开路径
    那么 缓冲应为空

  场景: 非 markdown 参数被忽略
    假如 命令行为 app.exe C:\docs\note.txt
    当 冷启动提取待打开路径
    那么 缓冲应为空

  场景: 扩展名大小写不敏感
    假如 命令行为 app.exe C:\docs\NOTE.MD
    当 冷启动提取待打开路径
    那么 缓冲中应包含 C:\docs\NOTE.MD
