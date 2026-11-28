# 公开站点

仓库所有人已同意本仓库公开，并用 GitHub Pages 发布 `site/`。仓库与站点对任何人都可见。不要把私有订阅、访问令牌或密钥放进仓库或 `site/`。

# 声间

手机优先的收听页。两个大分类卡片：**在听**（公开播客 RSS）和 **营销案例**（播客音频，加上用系统语音朗读的短导语）。选中的分类是实心紫色并标着「已选」。每条可听内容的「播放」右边紧挨着「下载」。无 Apple 品牌资产。

## 本地运行

在项目目录执行 `python3 -m http.server 8080 --directory site`，打开 http://localhost:8080 。不要直接双击 HTML。更新：`python3 scripts/update.py`（Python 3.10+，标准库，无 API 密钥）。

## GitHub Pages 部署

1. 选择你拥有管理权限的目标仓库，确认其可见性及发布内容；本交付未创建或上传仓库。
2. 将本目录全部内容（包括隐藏的 `.github`）提交到 main 分支。
3. 仓库 Settings → Pages → Source 选择 GitHub Actions；允许工作流使用 Pages write 和 id-token write 权限。
4. 手动运行 Update and deploy，成功后使用任务输出的网址。支持 repository 子路径。

工作流每天北京时间 07:00（GitHub cron 为 UTC 23:00，中国无夏令时）拉取播客和商业案例，并直接部署 artifact，不向仓库回写。定时任务可能延迟，长期不活跃的公共仓库可能被暂停计划任务。部署会公开 site 下全部内容，不能把私有订阅或访问令牌放入其中。上线地址仍是 https://oliver22yang-beep.github.io/poadcast/ 。

## RSS 与订阅

预置半拿铁 RSS https://proxy.wavpub.com/caffebreve.xml ，属于第三方代理地址，可能变化；版权属于节目作者。只存标题、日期和音频地址，不重新托管音频。罗永浩的十字路口没有加入：`https://feed.xyzfm.space/wmnkvmrpwuww` 返回 403 页面，Apple Podcasts 1834069371 的 feed 也是这个地址。可在「在听」里粘贴其它 HTTPS RSS，只保存在本机。手动订阅要求来源允许 CORS。当前解析 RSS 2.0 enclosure。

## 营销案例

和「在听」并列，一次只显示一个分类。每天由同一条 Update and deploy 工作流写入 `site/data/content.json`。来源混用音频和文字，都做成可听：

- 音频：营响·品牌营销随时听、虎嗅·商业有味道、MSAI营销科学（喜马拉雅公开 RSS，国内更容易打开）
- 朗读：36氪长文 RSS `https://www.36kr.com/feed-article`、虎嗅 `https://rss.huxiu.com/`

文字来源只保留标题、日期、原文链接和大约 80 字、尽量在句号处截断的一句导语。不保存全文，不生成语音文件。播放时由浏览器 `speechSynthesis` 用系统中文语音朗读这句导语。iPhone 请用 Safari，点「播放」才会出声；静音开关开着时可能没有声音。下载文章时保存的是这份短导语文本。音频的下载会在浏览器允许时保存文件；喜马拉雅等站点拒绝时改为打开原文件。站点不代理音频。

## 可靠性与限制

每源 25 秒超时、8MB 限制、单源失败保留输入快照中的该源内容并显示错误。Actions 每次从仓库初始快照启动，因此失败时回退到仓库快照，而非上一次部署；长期使用可另设持久化缓存或受控数据分支。

PWA 缓存同源页面及已读取数据，不缓存音频。离线可看已缓存列表，不能保证离线收听。iOS 可通过 Safari 分享菜单添加到主屏幕；安装能力依浏览器而异，正式上线建议补齐 192/512 PNG 图标。后台播放、锁屏行为受设备限制。浏览器播放错误会显示提示。未实现账号、搜索、订阅删除与云同步。下载依赖浏览器和音频源站：能跨域读取时直接保存，否则只能打开原地址。

已做 JavaScript 语法检查及真实 RSS 解析；未做真机、浏览器视觉或端到端播放验证。macOS Python 如出现证书错误请安装其受信任证书，不要关闭 TLS 校验。

## AI 原创节目（公开）
在 originals/ 下提交独立 JSON，字段 id（唯一小写字母数字和连字符）、title、date、summary、script、sources。部署先更新 RSS，再合并原创节目，不修改 RSS 原有摘要版权限制。无密钥时用系统语音分段朗读完整原创文稿。启用 Azure Speech 时，在 Actions secrets 设置 AZURE_SPEECH_KEY，Actions variables 设置 AZURE_SPEECH_REGION（全球 Azure 区域），自动生成 MP3；GitHub Actions 缓存减少重复合成，但缓存可能过期。合成失败保留文稿朗读。需要 ffmpeg。所有内容和音频公开，不得上传私人资料。费用由 Azure 账户承担，配置前核实额度。尚需真机验证。

## V3 实验版
顶部发现、收听、沉淀导航；发现搜索当前节目库（不是真实网络 Agent），最多10条，添加/收藏仅本设备保存。沉淀可选择多条收藏导出整合请求，不会自动调用 AI。继续收听支持音频进度，系统朗读从头开始。Azure 必须由账户所有者确认资源为 F0 后设 AZURE_F0_CONFIRMED=true；未确认或超预算时回退系统朗读。缓存账本仅是本项目保守估算，可能因缓存过期而丢失，不能代替 Azure F0 服务端限额；切勿配置 S0 密钥。公开网站只发布公开内容。

## V3 免费语音实验（替代 Azure 注册）
默认 TTS_ENGINE=edge，通过 edge-tts 生成公开原创文稿的 MP3，无需 API key。此工具并非微软正式提供的开发者 API，无长期可用性保证；应遵守服务条款，若不可用则停止调用并回退系统朗读，不绕过限制。每次构建最多尝试三个新节目，缓存按引擎、音色和文稿计算。可在 Actions variables 将 TTS_ENGINE 设置为 off（仅系统朗读）或 azure（仅确认 F0 后启用），不会自动调用其他付费服务。Kokoro 本地生成尚未接入。依赖 edge-tts 7.x 与 ffprobe；缓存可能被清理，音频持久化尚待改进。请勿上传私有文稿。