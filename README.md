# 宁波机场四期扩建辅助决策系统

CesiumJS 地图与政务蓝工作台。旧版演示原型保存在 `prototype/`。

## 运行

需要 Node.js 22.12 或以上版本。Windows PowerShell 中运行：

```powershell
npm.cmd ci
npm.cmd run dev
```

打开 [本地系统](http://127.0.0.1:5173/)。`npm.cmd run build` 输出到 `dist/`，用 HTTP 静态服务器提供访问。地图需要浏览器支持 WebGL，且能连接瓦片服务。

默认电子底图为 Esri Light Gray Canvas，遥感影像为 Esri World Imagery。在右下角「图层」切换底图，开关建筑矢量瓦片与地形。建筑图层在研究范围内读取 CARTO/OpenStreetMap MVT 的 `building` 图层并贴地渲染，可用轮廓取决于数据源覆盖。地形默认关闭，开启后使用 Mapzen Terrarium 高程瓦片。生产环境可在 `src/map.js` 与 `src/reference-layers.js` 中配置已授权的服务。

## 数据与统计口径

- 噪声来自 `data/机场噪音CGCS2000.shp` 及其配套属性、投影文件。9 条闭合线按 70、75、80、85、90 五档围合。同档合并生成累计范围，相邻阈值相减生成互斥分区。面积按 WGS84 椭球计算。
- 源文件未提供评价指标、时段和工况。界面按原始属性中的阈值展示。噪声覆盖面积为等值线完整范围，尚未按区、街道或村界裁切。
- 行政筛选采用海曙区政府公布的[行政区划名录（2020 年）](https://www.haishu.gov.cn/art/2020/8/21/art_1229829853_59034678.html)中的石碶街道和古林镇。它用于过滤对象归属。
- 行政边界保存在 `public/administrative-boundaries.geojson`。内置 [海曙区](https://www.openstreetmap.org/relation/4571617)、[石碶街道](https://www.openstreetmap.org/relation/11242960)、[古林镇](https://www.openstreetmap.org/relation/11257074)的 OpenStreetMap 边界，按 [ODbL](https://www.openstreetmap.org/copyright) 提供。选择区域时蓝线高亮并定位；缺少村界时显示所属街道（镇）边界，并提示。可在同一 GeoJSON 文件加入正式村界，使用 WGS84 的 Polygon 或 MultiPolygon，属性包含与筛选项一致的 `district`、`town`、`village`，以及来源 `source`。边界展示不会改变噪声面积口径。
- 当前目录未包含村界、建筑、医院、小学正式图层，统计显示「未接入」。建筑矢量底图只供地图参考。未提供任何土地权属图层时，转换脚本生成两类模拟地块并与实际噪声分区求交。地块边界、权属和行政归属为模拟值。接入任一正式土地权属图层后，脚本停止生成模拟地块，防止混入正式统计。

## 重新生成数据与接入对象图层

在 `data/` 目录放入相应的 RFC 7946 GeoJSON `FeatureCollection`，坐标为 WGS84 经度、纬度。

| 文件名 | 对象 | 几何 |
| --- | --- | --- |
| village.geojson | 行政村 | 面或多面 |
| building.geojson | 建筑 | 面或多面 |
| hospital.geojson | 医院院区 | 点、面或多面 |
| school.geojson | 小学校区 | 点、面或多面 |
| state-land.geojson | 国有用地 | 面或多面 |
| collective-land.geojson | 集体用地 | 面或多面 |

每个对象需有 `id`、`name`、`district`、`town`、`village` 属性。每个图层的 ID 必须唯一。土地权属图层要先处理相互重叠的地块。村、建筑、医院和小学按最高涉及等级归档，土地按各噪声分区的相交面积汇总，地块数按 ID 去重。医院和小学用点位时按落点判定，无法计算覆盖面积。

安装 Python 3.12 或以上版本的依赖并更新浏览器读取的数据文件：

```powershell
python -m pip install -r requirements-gis.txt
python scripts/prepare-data.py
npm.cmd test
```

`public/airport-data.json` 随项目提供，首次启动无须重新转换。替换源数据后须重新转换，再刷新页面或重新构建。
