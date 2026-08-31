import { useEffect, useMemo, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl'
import type { FeatureCollection as GeoJsonFeatureCollection, Geometry } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Cloud, ExternalLink, Eye, Filter, Info, Layers, Pause, Play, Radar, Satellite } from 'lucide-react'
import './App.css'

type Scene = {
  id: string
  productId: string
  platform: string
  mission: string
  sensor: string
  dataType: 'optical' | 'sar' | string
  processingLevel: string
  acquiredAtUtc: string
  acquiredAtNepal: string
  resolutionMeters: number | null
  cloudCoverPercent: number | null
  footprint: Geometry | null
  source: string
  sourceUrl: string
  stacItemUrl?: string
  license: 'open' | 'restricted'
  displayMode: 'full' | 'metadata-only'
  assets: Record<string, string>
  qualityFlags: string[]
}

type FeatureCollection = GeoJsonFeatureCollection
type FilterType = 'all' | 'optical' | 'sar'
type Speed = 'slow' | 'normal' | 'fast'

const osmStyle: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
}

const speedMs: Record<Speed, number> = { slow: 2600, normal: 1500, fast: 750 }

function formatUtc(value?: string) {
  if (!value) return 'Unknown'
  return value.replace('T', ' ').replace(/:\d\dZ$/, ' UTC')
}

function formatNpt(value?: string) {
  if (!value) return 'Unknown'
  return value.replace('T', ' ').replace(/\+05:45$/, ' NPT')
}

function sceneDay(scene: Scene) {
  return new Date(scene.acquiredAtUtc).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    timeZone: 'Asia/Kathmandu',
  })
}

function missionKey(scene: Scene) {
  if (scene.mission.includes('Sentinel-1')) return 'Sentinel-1'
  if (scene.mission.includes('Sentinel-2')) return 'Sentinel-2'
  if (scene.mission.includes('Sentinel-3')) return 'Sentinel-3'
  if (scene.mission.includes('Landsat')) return 'Landsat'
  if (scene.mission.includes('MODIS')) return 'MODIS'
  if (scene.mission.includes('VIIRS')) return 'VIIRS'
  return scene.mission
}

function cloudBucket(scene: Scene) {
  const cloud = scene.cloudCoverPercent
  if (cloud == null) return 'Unknown'
  if (cloud <= 20) return '0-20%'
  if (cloud <= 50) return '20-50%'
  if (cloud <= 80) return '50-80%'
  return '80-100%'
}

function rasterAsset(scene: Scene) {
  const preferred = scene.assets.visual || scene.assets.red || scene.assets.vv
  if (!preferred || !preferred.startsWith('http')) return null
  if (!/\.(tif|tiff)(\?|$)/i.test(preferred)) return null
  return preferred
}

function tileUrl(scene: Scene) {
  const asset = rasterAsset(scene)
  if (!asset || scene.displayMode !== 'full') return null
  return `https://titiler.xyz/cog/tiles/{z}/{x}/{y}.png?url=${encodeURIComponent(asset)}`
}

function boundsFromGeojson(fc: FeatureCollection): maplibregl.LngLatBoundsLike {
  const bounds = new maplibregl.LngLatBounds()
  const walk = (coords: unknown): void => {
    if (Array.isArray(coords) && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      bounds.extend([coords[0], coords[1]])
      return
    }
    if (Array.isArray(coords)) coords.forEach(walk)
  }
  fc.features.forEach((feature) => {
    const geometry = feature.geometry
    if (geometry.type === 'GeometryCollection') {
      geometry.geometries.forEach((item) => {
        if ('coordinates' in item) walk(item.coordinates)
      })
      return
    }
    walk(geometry.coordinates)
  })
  return bounds
}

function sceneCollection(scenes: Scene[], activeId: string): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: scenes
      .filter((scene) => scene.footprint)
      .map((scene) => ({
        type: 'Feature',
        properties: {
          id: scene.id,
          mission: missionKey(scene),
          displayMode: scene.displayMode,
          active: scene.id === activeId,
        },
        geometry: scene.footprint as Geometry,
      })),
  }
}

function addCoreLayers(map: MlMap, aoi: FeatureCollection, scenes: Scene[], activeId: string) {
  if (!map.getSource('aoi')) {
    map.addSource('aoi', { type: 'geojson', data: aoi })
    map.addLayer({
      id: 'aoi-fill',
      type: 'fill',
      source: 'aoi',
      paint: { 'fill-color': '#1f7a5c', 'fill-opacity': 0.12 },
    })
    map.addLayer({
      id: 'aoi-line',
      type: 'line',
      source: 'aoi',
      paint: { 'line-color': '#0b6b53', 'line-width': 2 },
    })
  }

  const footprints = sceneCollection(scenes, activeId)
  if (!map.getSource('footprints')) {
    map.addSource('footprints', { type: 'geojson', data: footprints })
    map.addLayer({
      id: 'footprint-fill',
      type: 'fill',
      source: 'footprints',
      paint: {
        'fill-color': ['case', ['==', ['get', 'active'], true], '#f6c453', '#3388ff'],
        'fill-opacity': ['case', ['==', ['get', 'active'], true], 0.24, 0.06],
      },
    })
    map.addLayer({
      id: 'footprint-line',
      type: 'line',
      source: 'footprints',
      paint: {
        'line-color': ['case', ['==', ['get', 'active'], true], '#f59e0b', '#2b6cb0'],
        'line-width': ['case', ['==', ['get', 'active'], true], 3, 1.3],
      },
    })
  } else {
    ;(map.getSource('footprints') as GeoJSONSource).setData(footprints)
  }
}

function setRaster(map: MlMap, scene: Scene | undefined, opacity: number, prefix = 'active') {
  const sourceId = `${prefix}-raster`
  const layerId = `${prefix}-raster-layer`
  if (map.getLayer(layerId)) map.removeLayer(layerId)
  if (map.getSource(sourceId)) map.removeSource(sourceId)
  const tiles = scene ? tileUrl(scene) : null
  if (!tiles) return
  map.addSource(sourceId, { type: 'raster', tiles: [tiles], tileSize: 256, attribution: scene?.source ?? '' })
  map.addLayer(
    {
      id: layerId,
      type: 'raster',
      source: sourceId,
      paint: { 'raster-opacity': opacity / 100, 'raster-fade-duration': 120 },
    },
    'footprint-fill',
  )
}

export default function App() {
  const mapRef = useRef<MlMap | null>(null)
  const rightMapRef = useRef<MlMap | null>(null)
  const mapEl = useRef<HTMLDivElement | null>(null)
  const rightMapEl = useRef<HTMLDivElement | null>(null)
  const [scenes, setScenes] = useState<Scene[]>([])
  const [aoi, setAoi] = useState<FeatureCollection | null>(null)
  const [auditCount, setAuditCount] = useState(0)
  const [activeId, setActiveId] = useState('')
  const [filterType, setFilterType] = useState<FilterType>('all')
  const [mission, setMission] = useState('All')
  const [cloud, setCloud] = useState('All')
  const [opacity, setOpacity] = useState(78)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<Speed>('normal')
  const [compare, setCompare] = useState(false)
  const [rightId, setRightId] = useState('')
  const [swipe, setSwipe] = useState(50)
  const [mapLoaded, setMapLoaded] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch('/data/scenes.json').then((r) => r.json()),
      fetch('/data/aoi.geojson').then((r) => r.json()),
      fetch('/data/source-audit.json').then((r) => r.json()),
    ]).then(([sceneData, aoiData, auditData]) => {
      setScenes(sceneData)
      setAoi(aoiData)
      setAuditCount(auditData.length)
      setActiveId(sceneData[0]?.id ?? '')
      setRightId(sceneData.find((scene: Scene) => scene.id !== sceneData[0]?.id)?.id ?? '')
    })
  }, [])

  const activeScene = scenes.find((scene) => scene.id === activeId)
  const rightScene = scenes.find((scene) => scene.id === rightId)
  const filtered = useMemo(() => {
    return scenes.filter((scene) => {
      if (filterType !== 'all' && scene.dataType !== filterType) return false
      if (mission !== 'All' && missionKey(scene) !== mission) return false
      if (cloud !== 'All' && cloudBucket(scene) !== cloud) return false
      return true
    })
  }, [scenes, filterType, mission, cloud])
  const missions = useMemo(() => ['All', ...Array.from(new Set(scenes.map(missionKey)))], [scenes])
  const openScenes = scenes.filter((scene) => scene.license === 'open').length
  const rasterReady = scenes.filter((scene) => tileUrl(scene)).length

  useEffect(() => {
    if (!mapEl.current || !aoi || mapRef.current) return
    const map = new maplibregl.Map({
      container: mapEl.current,
      style: osmStyle,
      center: [85.2, 28.05],
      zoom: 8,
      attributionControl: {},
    })
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left')
    map.on('load', () => {
      setMapLoaded(true)
      map.fitBounds(boundsFromGeojson(aoi), { padding: 42, duration: 0 })
    })
    mapRef.current = map
    return () => map.remove()
  }, [aoi])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !aoi || !mapLoaded || !map.isStyleLoaded()) return
    addCoreLayers(map, aoi, scenes, activeId)
    setRaster(map, activeScene, opacity)
  }, [aoi, scenes, activeId, activeScene, opacity, mapLoaded])

  useEffect(() => {
    if (!compare || !rightMapEl.current || !aoi || rightMapRef.current) return
    const left = mapRef.current
    const right = new maplibregl.Map({
      container: rightMapEl.current,
      style: osmStyle,
      center: left?.getCenter() ?? [85.2, 28.05],
      zoom: left?.getZoom() ?? 8,
      bearing: left?.getBearing() ?? 0,
      pitch: left?.getPitch() ?? 0,
      interactive: false,
      attributionControl: false,
    })
    right.on('load', () => {
      addCoreLayers(right, aoi, scenes, rightId)
      setRaster(right, rightScene, opacity, 'right')
    })
    rightMapRef.current = right
    return () => {
      right.remove()
      rightMapRef.current = null
    }
  }, [compare, aoi, scenes, rightId, rightScene, opacity])

  useEffect(() => {
    const left = mapRef.current
    const right = rightMapRef.current
    if (!left || !right) return
    const sync = () => {
      right.jumpTo({ center: left.getCenter(), zoom: left.getZoom(), bearing: left.getBearing(), pitch: left.getPitch() })
    }
    left.on('move', sync)
    return () => {
      left.off('move', sync)
    }
  }, [compare])

  useEffect(() => {
    const right = rightMapRef.current
    if (!right || !aoi || !right.isStyleLoaded()) return
    addCoreLayers(right, aoi, scenes, rightId)
    setRaster(right, rightScene, opacity, 'right')
  }, [aoi, scenes, rightId, rightScene, opacity])

  useEffect(() => {
    if (!playing || scenes.length === 0) return
    const timer = window.setInterval(() => {
      setActiveId((current) => {
        const index = scenes.findIndex((scene) => scene.id === current)
        return scenes[(index + 1) % scenes.length].id
      })
    }, speedMs[speed])
    return () => window.clearInterval(timer)
  }, [playing, scenes, speed])

  return (
    <main className="app-shell">
      <section className="map-stage">
        <div className="map-header">
          <div>
            <p className="eyebrow">EMSR927 Nepal river valley</p>
            <h1>Satellite acquisition timeline</h1>
          </div>
          <div className="status-strip">
            <span><Satellite size={16} /> {scenes.length} scenes</span>
            <span><Eye size={16} /> {openScenes} open</span>
            <span><Layers size={16} /> {rasterReady} streamable</span>
          </div>
        </div>

        <div className="map-wrap">
          <div className="map" ref={mapEl} />
          {compare && (
            <div className="right-map-clip" style={{ clipPath: `inset(0 0 0 ${swipe}%)` }}>
              <div className="map compare-map" ref={rightMapEl} />
            </div>
          )}
          {compare && (
            <input aria-label="Before after swipe" className="swipe" max="100" min="0" onChange={(event) => setSwipe(Number(event.target.value))} type="range" value={swipe} />
          )}
        </div>

        <div className="timeline">
          <div className="timeline-actions">
            <button className="icon-button" onClick={() => setPlaying((value) => !value)} type="button" title={playing ? 'Pause' : 'Play'}>
              {playing ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <select aria-label="Animation speed" value={speed} onChange={(event) => setSpeed(event.target.value as Speed)}>
              <option value="slow">Slow</option>
              <option value="normal">Normal</option>
              <option value="fast">Fast</option>
            </select>
            <label>
              Opacity
              <input min="0" max="100" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} type="range" />
            </label>
          </div>
          <div className="time-track">
            {scenes.map((scene) => (
              <button className={`time-dot ${scene.id === activeId ? 'active' : ''} ${scene.license !== 'open' ? 'restricted' : ''}`} key={scene.id} onClick={() => setActiveId(scene.id)} title={`${scene.platform} ${formatNpt(scene.acquiredAtNepal)} ${scene.resolutionMeters ?? 'Unknown'}m`} type="button">
                <span>{sceneDay(scene)}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <aside className="side-panel">
        <section className="panel-block">
          <div className="panel-title"><Filter size={17} /> Satellite scenes</div>
          <div className="segmented">
            {(['all', 'optical', 'sar'] as FilterType[]).map((value) => (
              <button className={filterType === value ? 'selected' : ''} key={value} onClick={() => setFilterType(value)} type="button">{value}</button>
            ))}
          </div>
          <select value={mission} onChange={(event) => setMission(event.target.value)} aria-label="Mission filter">
            {missions.map((item) => <option key={item}>{item}</option>)}
          </select>
          <select value={cloud} onChange={(event) => setCloud(event.target.value)} aria-label="Cloud cover filter">
            {['All', '0-20%', '20-50%', '50-80%', '80-100%', 'Unknown'].map((item) => <option key={item}>{item}</option>)}
          </select>
        </section>

        <section className="active-card">
          <div className="scene-kind">
            {activeScene?.dataType === 'sar' ? <Radar size={16} /> : <Cloud size={16} />}
            {activeScene?.dataType === 'sar' ? 'SAR radar imagery' : 'Optical or browse imagery'}
          </div>
          <h2>{activeScene?.platform ?? 'Loading scenes'}</h2>
          <dl>
            <div><dt>UTC</dt><dd>{formatUtc(activeScene?.acquiredAtUtc)}</dd></div>
            <div><dt>Nepal</dt><dd>{formatNpt(activeScene?.acquiredAtNepal)}</dd></div>
            <div><dt>Resolution</dt><dd>{activeScene?.resolutionMeters ?? 'Unknown'} m</dd></div>
            <div><dt>Cloud</dt><dd>{activeScene?.cloudCoverPercent ?? 'Unknown'}</dd></div>
            <div><dt>Product</dt><dd>{activeScene?.productId ?? 'Unknown'}</dd></div>
            <div><dt>Source</dt><dd>{activeScene?.source ?? 'Unknown'}</dd></div>
            <div><dt>License</dt><dd>{activeScene?.license ?? 'Unknown'}</dd></div>
          </dl>
          {activeScene?.qualityFlags.includes('VERY_CLOUDY') && <p className="warning">Cloud cover may obscure the valley.</p>}
          {activeScene?.displayMode === 'metadata-only' && <p className="warning">Metadata only. Restricted or non-tiled raster is not displayed.</p>}
          {activeScene?.stacItemUrl && (
            <a className="meta-link" href={activeScene.stacItemUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={15} /> Original metadata
            </a>
          )}
        </section>

        <section className="panel-block compare-controls">
          <label className="toggle">
            <input type="checkbox" checked={compare} onChange={(event) => setCompare(event.target.checked)} />
            Before / After
          </label>
          <select value={rightId} onChange={(event) => setRightId(event.target.value)} aria-label="Right scene">
            {scenes.map((scene) => (
              <option key={scene.id} value={scene.id}>{scene.platform} {formatNpt(scene.acquiredAtNepal)}</option>
            ))}
          </select>
        </section>

        <section className="scene-list">
          {filtered.map((scene) => (
            <article className={scene.id === activeId ? 'scene-row selected' : 'scene-row'} key={scene.id}>
              <button onClick={() => setActiveId(scene.id)} type="button">
                <strong>{scene.platform}</strong>
                <span>{formatNpt(scene.acquiredAtNepal)}</span>
                <small>{missionKey(scene)} - {scene.resolutionMeters ?? 'Unknown'} m - cloud {scene.cloudCoverPercent ?? 'Unknown'}</small>
              </button>
            </article>
          ))}
        </section>

        <footer className="audit-note">
          <Info size={15} /> {auditCount} catalog checks. OSM attribution stays visible on the map.
        </footer>
      </aside>
    </main>
  )
}
