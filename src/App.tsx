import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import { CalendarDays, Cloud, Layers, Mountain, Satellite, ScanLine, Waves } from 'lucide-react'

type Phase = 'before' | 'after'

type Scene = {
  id: string
  phase: Phase
  title: string
  datetimeUtc: string
  datetimeNepal: string
  cloud: number
  cog: string
  preview: string
  bounds: [number, number, number, number]
}

const aoiBounds: L.LatLngBoundsExpression = [
  [27.675376, 84.351228],
  [28.279944, 85.380579],
]

const valleyCenter: L.LatLngExpression = [27.93, 85.14]

function dataUrl(path: string) {
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`
}

function titilerUrl(scene: Scene) {
  return `https://titiler.xyz/cog/tiles/WebMercatorQuad/{z}/{x}/{y}?url=${encodeURIComponent(scene.cog)}&tilesize=512`
}

function leafletBounds(scene: Scene): L.LatLngBoundsExpression {
  const [west, south, east, north] = scene.bounds
  return [
    [south, west],
    [north, east],
  ]
}

function nptLabel(value: string) {
  return value.replace('T', ' ').replace('+05:45', ' NPT')
}

function utcLabel(value: string) {
  return value.replace('T', ' ').replace('Z', ' UTC')
}

function bestScene(scenes: Scene[], phase: Phase) {
  const phaseScenes = scenes.filter((scene) => scene.phase === phase)
  return phaseScenes.find((scene) => scene.id.includes('45RUL')) ?? phaseScenes.sort((a, b) => a.cloud - b.cloud)[0]
}

export default function App() {
  const mapEl = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const beforeLayer = useRef<L.TileLayer | null>(null)
  const afterLayer = useRef<L.TileLayer | null>(null)
  const [scenes, setScenes] = useState<Scene[]>([])
  const [beforeId, setBeforeId] = useState('')
  const [afterId, setAfterId] = useState('')
  const [swipe, setSwipe] = useState(52)
  const [opacity, setOpacity] = useState(82)
  const [showDem, setShowDem] = useState(true)

  useEffect(() => {
    fetch(dataUrl('data/sentinel-scenes.json'))
      .then((response) => response.json())
      .then((sceneData: Scene[]) => {
        setScenes(sceneData)
        setBeforeId(bestScene(sceneData, 'before')?.id ?? sceneData[0]?.id ?? '')
        setAfterId(bestScene(sceneData, 'after')?.id ?? sceneData[0]?.id ?? '')
      })
  }, [])

  const beforeScenes = useMemo(() => scenes.filter((scene) => scene.phase === 'before'), [scenes])
  const afterScenes = useMemo(() => scenes.filter((scene) => scene.phase === 'after'), [scenes])
  const before = scenes.find((scene) => scene.id === beforeId)
  const after = scenes.find((scene) => scene.id === afterId)

  useEffect(() => {
    if (!mapEl.current || mapRef.current) return

    const map = L.map(mapEl.current, {
      center: valleyCenter,
      zoom: 10,
      zoomControl: false,
    })

    map.createPane('demPane')
    map.createPane('beforePane')
    map.createPane('afterPane')
    map.createPane('labelPane')
    map.getPane('demPane')!.style.zIndex = '190'
    map.getPane('beforePane')!.style.zIndex = '230'
    map.getPane('afterPane')!.style.zIndex = '240'
    map.getPane('labelPane')!.style.zIndex = '260'
    map.getPane('afterPane')!.style.clipPath = `inset(0 0 0 ${swipe}%)`

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map)

    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}', {
      pane: 'demPane',
      opacity: 0.32,
      attribution: 'Hillshade &copy; Esri',
      maxZoom: 16,
    }).addTo(map)

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', {
      pane: 'labelPane',
      attribution: '&copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 20,
    }).addTo(map)

    L.rectangle(aoiBounds, {
      color: '#ffbf47',
      weight: 2,
      fillColor: '#ffbf47',
      fillOpacity: 0.06,
      dashArray: '6 6',
    }).addTo(map)

    L.control.zoom({ position: 'bottomleft' }).addTo(map)
    map.fitBounds([
      [27.70, 84.80],
      [28.08, 85.38],
    ], { padding: [18, 18] })
    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const pane = mapRef.current?.getPane('afterPane')
    if (pane) pane.style.clipPath = `inset(0 0 0 ${swipe}%)`
  }, [swipe])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !before || !after) return

    beforeLayer.current?.remove()
    afterLayer.current?.remove()

    beforeLayer.current = L.tileLayer(titilerUrl(before), {
      pane: 'beforePane',
      opacity: opacity / 100,
      bounds: leafletBounds(before),
      attribution: 'Sentinel-2 COG &copy; Copernicus / Element84 / TiTiler',
      maxZoom: 14,
    }).addTo(map)

    afterLayer.current = L.tileLayer(titilerUrl(after), {
      pane: 'afterPane',
      opacity: opacity / 100,
      bounds: leafletBounds(after),
      attribution: 'Sentinel-2 COG &copy; Copernicus / Element84 / TiTiler',
      maxZoom: 14,
    }).addTo(map)
  }, [before, after, opacity])

  useEffect(() => {
    beforeLayer.current?.setOpacity(opacity / 100)
    afterLayer.current?.setOpacity(opacity / 100)
  }, [opacity])

  useEffect(() => {
    const pane = mapRef.current?.getPane('demPane')
    if (pane) pane.style.display = showDem ? '' : 'none'
  }, [showDem])

  return (
    <main className="viewer">
      <section className="map-shell">
        <div ref={mapEl} className="map" />
        <div className="swipe-line" style={{ left: `${swipe}%` }}>
          <span>After</span>
        </div>
        <input
          aria-label="Before after swipe"
          className="swipe-range"
          max="100"
          min="0"
          onChange={(event) => setSwipe(Number(event.target.value))}
          type="range"
          value={swipe}
        />
        <div className="map-badge before-badge">Before: {before ? nptLabel(before.datetimeNepal) : 'loading'}</div>
        <div className="map-badge after-badge">After: {after ? nptLabel(after.datetimeNepal) : 'loading'}</div>
      </section>

      <aside className="panel">
        <header>
          <p><Waves size={16} /> Nepal river valley</p>
          <h1>Sentinel flood compare</h1>
        </header>

        <section className="controls">
          <label>
            <span><CalendarDays size={16} /> Before scene</span>
            <select value={beforeId} onChange={(event) => setBeforeId(event.target.value)}>
              {beforeScenes.map((scene) => (
                <option key={scene.id} value={scene.id}>
                  {nptLabel(scene.datetimeNepal)} - cloud {scene.cloud.toFixed(0)}%
                </option>
              ))}
            </select>
          </label>

          <label>
            <span><CalendarDays size={16} /> After scene</span>
            <select value={afterId} onChange={(event) => setAfterId(event.target.value)}>
              {afterScenes.map((scene) => (
                <option key={scene.id} value={scene.id}>
                  {nptLabel(scene.datetimeNepal)} - cloud {scene.cloud.toFixed(0)}%
                </option>
              ))}
            </select>
          </label>

          <label>
            <span><ScanLine size={16} /> Swipe</span>
            <input min="0" max="100" value={swipe} onChange={(event) => setSwipe(Number(event.target.value))} type="range" />
          </label>

          <label>
            <span><Layers size={16} /> Sentinel opacity</span>
            <input min="20" max="100" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} type="range" />
          </label>

          <label className="toggle">
            <input type="checkbox" checked={showDem} onChange={(event) => setShowDem(event.target.checked)} />
            <span><Mountain size={16} /> DEM hillshade</span>
          </label>
        </section>

        <section className="scene-card before-card">
          <div className="card-title"><Satellite size={16} /> Before Sentinel-2</div>
          {before && <SceneDetails scene={before} />}
        </section>

        <section className="scene-card after-card">
          <div className="card-title"><Satellite size={16} /> After Sentinel-2</div>
          {after && <SceneDetails scene={after} />}
        </section>

        <footer>
          <Cloud size={15} />
          Sentinel-2 scenes are true-color georeferenced COG tiles from Element84 Earth Search. The clearest available pair is selected by default.
        </footer>
      </aside>
    </main>
  )
}

function SceneDetails({ scene }: { scene: Scene }) {
  return (
    <>
      <a href={scene.preview} target="_blank" rel="noreferrer" className="preview">
        <img src={scene.preview} alt={`${scene.id} preview`} />
      </a>
      <dl>
        <div><dt>Scene</dt><dd>{scene.id}</dd></div>
        <div><dt>Nepal</dt><dd>{nptLabel(scene.datetimeNepal)}</dd></div>
        <div><dt>UTC</dt><dd>{utcLabel(scene.datetimeUtc)}</dd></div>
        <div><dt>Cloud</dt><dd>{scene.cloud.toFixed(1)}%</dd></div>
      </dl>
    </>
  )
}
