# web-file-explorer

一个基于 Python + Flask 的网页文件浏览器，可在浏览器里查看本机文件系统（受根目录限制），支持：

- 展示文件/目录列表
- 展示文件名、大小、修改日期
- 点击目录进入下一级
- 返回上级目录
- 按类型、名称、大小、修改日期排序
- 下载文件

## 运行方式

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

默认访问：`http://127.0.0.1:8000`

## 可选配置

可通过环境变量限制浏览范围根目录（默认 `/`）：

```bash
export FILE_BROWSER_ROOT=/home/yourname
python app.py
```

> 出于安全考虑，后端会拒绝访问 `FILE_BROWSER_ROOT` 之外的路径。
