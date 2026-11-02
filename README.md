# GloveAR · VONGOLA 手套实时叠加

浏览器里的实时手部 AR 演示：通过摄像头和 MediaPipe Hands 追踪双手，把 3D 手套模型重定向到真实手上；握拳时在拳头周围点燃程序化的大空火焰，张手熄灭。

纯静态前端，无后端、无构建步骤。

## 特性

- **双手追踪**：MediaPipe Hands 识别左右手，两只手套各自贴合
- **骨骼重定向**：用 21 个手部关键点驱动手套骨骼，含镜像处理
- **握拳点火 / 张手熄灭**：带滞回阈值和防抖，避免临界手势来回闪烁
- **程序化火焰球**（`js/flame3d.js`）：
  - 橙色边缘 + 内部金→橙红渐变的半透明球体
  - 3D 噪声生成向上卷动的内部火舌
  - 顶部按角度分裂出火苗尖端，会舔动、外扩
  - 手快速移动时火焰沿运动方向拉伸、横向收紧并轻微拖后
  - 点燃时上浮、缓慢浮动
- **仅火焰 bloom**：火焰单独渲染到一层再叠加辉光，亮银色手套不会被泛光糊掉
- **2D 光晕与粒子**：掌心光晕、余烬、火花补充氛围

## 运行

需要 Node.js（仅用于静态文件服务）和支持摄像头权限的现代浏览器（推荐 Chrome / Edge）。

```bash
node server.js
```

打开 <http://127.0.0.1:8741/>，允许摄像头权限即可。

Windows 下也可以直接双击 `start.cmd`：它会启动服务并打开浏览器。

## 操作

| 操作 | 效果 |
| --- | --- |
| 握拳 | 点燃火焰 |
| 张开手掌 | 熄灭火焰 |
| 右下角 ⇄ 按钮 | 切换左右手镜像 |

## 调试参数

在 URL 后追加参数：

| 参数 | 作用 |
| --- | --- |
| `?selftest=1` | 用合成手做重定向自检，不启用摄像头 |
| `&two=1` | 加入第二只合成手 |
| `&fist=1` | 合成手握拳（用于检查点火） |
| `&fire=1` | 强制火焰满强度（用于截图） |
| `?raw=1` | 显示手套绑定姿态 |

例如：

```text
http://127.0.0.1:8741/?selftest=1&two=1&fist=1&fire=1
```

## 目录结构

```text
index.html          页面与 importmap
server.js           极简静态服务器（仅监听 127.0.0.1）
start.cmd           Windows 启动脚本
js/
  app.js            场景、渲染循环、bloom 合成
  config.js         可调参数（阈值、平滑、辉光强度等）
  hand-tracker.js   摄像头与 MediaPipe Hands
  retarget.js       关键点 -> 手套骨骼重定向
  flame3d.js        程序化火焰球（着色器）
  fire.js           2D 光晕、余烬、火花与手势状态
  selftest.js       合成手自检
css/style.css       页面样式
glove.glb           手套模型
flame.glb           早期网格火焰实验，当前渲染不再使用
tools/flame_build.py  生成 flame.glb 的 Blender 脚本
vendor/             three.js 及其 addons（MIT）
```

## 隐私

- 摄像头画面只在本机浏览器中处理，**不会上传**。
- MediaPipe Hands 的脚本和模型文件从 jsDelivr CDN 加载，页面本身不发送图像。
- 模型推理在浏览器本地完成。

## 第三方资源

- [three.js](https://github.com/mrdoob/three.js) — MIT
- [MediaPipe Hands](https://github.com/google-ai-edge/mediapipe) — Apache-2.0（运行时从 CDN 加载）

完整声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 免责声明

本项目是《家庭教师HITMAN REBORN!》的同人学习项目，与版权方无关；相关角色与设定版权归原作者及权利方所有，请勿用于商业用途。

## License

[MIT](LICENSE) © 2026 Jayjie
