# 全息棱锥播放器

把手机或平板变成桌面"全息"摆件：屏幕显示十字排布的四个画面，透明四面棱锥扣在上面，就能看到悬浮的立体影像。

在线使用：<https://yoink-gb6.github.io/KeepAlive/> （可"添加到主屏幕"，全屏离线使用）

## 用法

1. 屏幕亮度调到最高，环境调暗
2. 棱锥小头朝下，扣在屏幕正中
3. 点一下屏幕打开设置，运行"校准向导"

## 功能

内置

- [x] 水母
- [x] 烟花
- [x] 旋涡星系
- [x] 粒子星球
- [x] 线框地球
- [x] 文字环
- [x] 蝴蝶
- [x] 邦布
- [x] 海豚
- [x] 中指

导入

- [x] 3D 模型（.glb）
- [x] 照片
- [x] 照片自动抠图
- [x] 视频
- [ ] 四分屏视频
- [x] 背景音乐
- [x] 旋转相册

播放

- [x] 自动轮播
- [x] 校准向导
- [x] 画面大小、位置、亮度、转速
- [x] 静音
- [x] 离线可用
- [x] 屏幕常亮
- [ ] 定时息屏
- [ ] 礼物模式

## 本机运行

```
node serve.mjs
```

Windows 上也可以双击 `start.bat`。

## 第三方

- [Three.js](https://threejs.org/)，MIT
- [onnxruntime-web](https://github.com/microsoft/onnxruntime)，MIT
- [U²-Net](https://github.com/xuebinqin/U-2-Net)，Apache-2.0
- `glbs/` 里的模型来自网络，版权归各自作者
