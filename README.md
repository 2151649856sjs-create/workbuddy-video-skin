# WorkBuddy 视频动效皮肤

给 **WorkBuddy 桌面端**（app 5.9.3 实测）做的首页视频壁纸 + 侧栏玻璃化皮肤。

素材（mp4 / 底图）**不入库**，见「素材」一节自己生成；仓库只放规则与脚本，每次同步覆盖为最新完整版。

---

## 一、它是怎么动起来的

WorkBuddy 的换肤面板只认服务端下发的主题包，没有本地导入入口。但 5.9.3 的首页
`<main class="wb-home-route">` 里挂了 `HomeBgVideo` 组件，逻辑是：

```
读父元素(.wb-home-route) 上的 --wb-home-bg-video
→ getComputedStyle().getPropertyValue() 取值
→ /^url\((['"]?)(.+?)\1\)$/ 拆出地址
→ isAllowedSrc：必须以 local-file:// 或 blob: 开头，且不含 " ' ( ) 空白
→ 渲染 <video class="wb-home-route__bg-video" autoplay loop muted playsinline>
   自带 position:absolute; inset:0; width/height:100%; object-fit:cover; z-index:-1
```

所以皮肤里**只写一条 CSS 变量**就够了，不需要（也没法用纯 CSS）自己造 `<video>`。

⚠️ 相对路径必死：写 `url('./assets/x.mp4')` 时 computed 值会被解析成 `app://…`，
`isAllowedSrc` 直接拒，视频永远不出现、只剩兜底图。必须写**完整的 `local-file://` 绝对地址**。

主窗口 CSP 里 `media-src` 已含 `local-file:`，不用改 CSP。

## 二、文件

| 文件 | 作用 |
|---|---|
| `skin.v2.css` | 完整皮肤，直接替换到主题目录即可。末尾两段是本项目加的东西：视频壁纸变量、侧栏玻璃化 |
| `scripts/set_video_skin.js` | 持久化补丁：把 CSS 写进 localStorage 缓存、把主题包 `zipUrl` 打成不可信域名（让启动时 CDN 那份加载失败、不覆盖自制皮肤）、`agent-ui-theme` 钉 light |
| `scripts/dump_ls.js` | 只读排查用：dump 渲染进程 localStorage 里外观相关的键值 |
| `sync.sh` | 把本机最新皮肤与脚本收进仓库并推送 |

## 三、怎么用

1. 备份原皮肤，把 `skin.v2.css` 覆盖到：
   `~/.workbuddy/appearance-resources/<主题目录>/skin.v2.css`
   （主题目录名形如 `theme-tkbera-1789703092000`，不同机器不一样）
2. 在当前会话看到效果：设置 → 外观，切到别的皮肤再切回来（走磁盘路径，立刻生效）
3. 要**重启后也保持**：完全退出 WorkBuddy（托盘图标右键退出，关窗口只是收进托盘），
   再 `node scripts/set_video_skin.js`。脚本依赖 `classic-level`（`npm i classic-level`）。

补丁是写在磁盘上的，做一次即可。唯一会让它失效的是之后又在设置里切换皮肤 —— 那份快照会被
应用用合法 `zipUrl` 重写，重跑一次脚本即可。

## 四、素材（不入库，自己生成）

素材是别人工作台的录屏，带第三方品牌字样，**不适合托管在公开仓库**，所以 `.gitignore` 挡掉了。
把原片放好，用 ffmpeg 重新生成即可：

```bash
FF=ffmpeg
SRC=input.mp4            # 原始录屏
OUT=assets/custom

# 13.6s 无缝循环：裁掉播放器条 → 16:9 裁切保主体 → 柔化 → 左侧强模糊洗掉残留字样
# → 叠 40% 白蒙版提亮（浅色皮肤下压字才不糊）→ 正放 6.8s 接倒放
"$FF" -y -i "$SRC" -filter_complex "\
[0:v]trim=start=0:end=6.8,setpts=PTS-STARTPTS,crop=1226:690:226:0,gblur=sigma=10,\
scale=1280:720,eq=brightness=0.10:contrast=0.96:saturation=1.15,fps=30[b0];\
[b0]split[a][c];\
[c]gblur=sigma=45,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*clip((900-X)/260,0,1)'[m];\
[a][m]overlay=0:0,format=rgba[ov];\
color=white:s=1280x720:d=7,format=rgba,colorchannelmixer=aa=0.40[w];\
[ov][w]overlay=shortest=1,format=yuv420p[g];\
[g]split[p][q];[q]reverse[qr];[p][qr]concat=n=2:v=1:a=0[out]" \
  -map "[out]" -an -c:v libx264 -crf 25 -preset slow -pix_fmt yuv420p \
  -movflags +faststart "$OUT/home-bg-loop.mp4"

# 首帧兜底图（视频还没解码时先垫着）
"$FF" -y -i "$OUT/home-bg-loop.mp4" -frames:v 1 -q:v 3 "$OUT/home-bg-poster.jpg"
```

结果约 1280×720 / 400KB。然后把 `skin.v2.css` 里两处 `local-file://local/...` 的路径
改成你自己机器上的绝对路径（盘符冒号写成 `%3A`，其余原样）。

## 五、侧栏为什么要单独铺一张静态图

视频元素固定在 `.wb-home-route` 里，外层带 `overflow:hidden`。把它的 `position` 改成 `static`
能让视频铺满整窗，但 `main` 在 DOM 里靠后、层级更高，视频会盖到侧栏**文字上面**。
所以侧栏用同帧的静态 poster 铺在 `.claw-workspace` 外壳上，配合半透明白纱，
视觉上和动图连着，但不会吃掉交互。

皮肤里踩过的具体类名：

- 侧栏容器 `.conversation-list`（背景读 `--wb-sidebar-bg`）
- 薄荷绿实底在这几处：`.conversation-list-topbar / -header / -content / -footer`、
  `.conversation-section-label`、`.collapsible-section-header`
- 空间分组浮层 `.conversation-space-section-overlay`
- 折叠抽屉 `.claw-sidebar-drawer(--pinned)`

## 六、已知限制

- 服务端更新主题 `updatedAt` → 新目录 + 新缓存键，自制内容失效，要重做一次路径替换
- 在设置里切皮肤会把持久化补丁冲掉
- CSS 缓存有 512KB 上限（`writeAppearanceCssCache` 里硬编码 `524288`），超了静默不写

## 许可

`skin.v2.css` 是在 WorkBuddy 官方主题基础上做配色重映射与追加规则的衍生文件，
仅作个人使用与学习参考，不主张任何权利；原始主题版权归其发布方所有。
