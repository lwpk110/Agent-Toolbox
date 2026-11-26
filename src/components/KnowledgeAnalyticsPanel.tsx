import { useMemo, useState, type CSSProperties } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  CacheHitPoint,
  DocUpdatePoint,
  KnowledgeAnalytics,
  VectorDimensionBucket,
} from '../types/toolbox';
import { ProtoSeg, ProtoTip } from './ProtoPrimitives';

type ChartMode = 'overview' | 'updates' | 'dimensions' | 'cache';
type TimeRange = '7d' | '14d';

const DIM_COLORS = ['#0969da', '#1a7f37', '#8250df', '#9a6700'];

const AXIS_TICK = {
  fontSize: 11,
  fill: '#59636e',
  fontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
};

interface KnowledgeAnalyticsPanelProps {
  analytics: KnowledgeAnalytics;
  onOpenTip: (tip: { title: string; body: string }) => void;
}

interface TooltipPayloadEntry<T> {
  payload?: T;
  name?: string;
  value?: number | string;
  color?: string;
}

function UpdateTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: ReadonlyArray<TooltipPayloadEntry<DocUpdatePoint>>;
  label?: string | number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="kb-tooltip">
      <div className="kb-tooltip-title">{label}</div>
      <div className="kb-tooltip-row">
        <span className="kb-tooltip-key">
          <span className="kb-legend-swatch" style={{ background: '#0969da' }} />
          新增入库
        </span>
        <span className="kb-tooltip-val">{row.created} 篇</span>
      </div>
      <div className="kb-tooltip-row">
        <span className="kb-tooltip-key">
          <span className="kb-legend-swatch" style={{ background: '#54aeff' }} />
          更新重切片
        </span>
        <span className="kb-tooltip-val">{row.updated} 次</span>
      </div>
      <div className="kb-tooltip-row">
        <span className="kb-tooltip-key">
          <span className="kb-legend-line" style={{ background: '#1f883d' }} />
          切片增量
        </span>
        <span className="kb-tooltip-val">+{row.chunksDelta} 段</span>
      </div>
    </div>
  );
}

function DimensionTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<TooltipPayloadEntry<VectorDimensionBucket>>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="kb-tooltip">
      <div className="kb-tooltip-title">
        {row.dimension} · {row.spaceLabel}
      </div>
      <div className="kb-tooltip-row">
        <span className="kb-tooltip-key">嵌入模型</span>
        <span className="kb-tooltip-val">{row.model}</span>
      </div>
      <div className="kb-tooltip-row">
        <span className="kb-tooltip-key">向量切片数</span>
        <span className="kb-tooltip-val">{row.chunks} 段</span>
      </div>
      <div className="kb-tooltip-row">
        <span className="kb-tooltip-key">占比 / 来源数</span>
        <span className="kb-tooltip-val">
          {row.sharePct}% · {row.docs} 项
        </span>
      </div>
    </div>
  );
}

function CacheHitTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: ReadonlyArray<TooltipPayloadEntry<CacheHitPoint>>;
  label?: string | number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="kb-tooltip">
      <div className="kb-tooltip-title">{label}</div>
      <div className="kb-tooltip-row">
        <span className="kb-tooltip-key">
          <span className="kb-legend-swatch" style={{ background: '#1f883d' }} />
          综合命中率
        </span>
        <span className="kb-tooltip-val">{row.hitRate.toFixed(1)}%</span>
      </div>
      <div className="kb-tooltip-row">
        <span className="kb-tooltip-key">
          <span className="kb-legend-line" style={{ background: '#0969da' }} />
          语义缓存命中
        </span>
        <span className="kb-tooltip-val">{row.semanticHitRate.toFixed(1)}%</span>
      </div>
      <div className="kb-tooltip-row">
        <span className="kb-tooltip-key">
          <span className="kb-legend-line" style={{ background: '#8250df' }} />
          精确 KV 命中
        </span>
        <span className="kb-tooltip-val">{row.exactHitRate.toFixed(1)}%</span>
      </div>
      <div className="kb-tooltip-row">
        <span className="kb-tooltip-key">检索量 / 平均耗时</span>
        <span className="kb-tooltip-val">
          {row.queries} 次 · {row.avgLatencyMs}ms
        </span>
      </div>
    </div>
  );
}

export function KnowledgeAnalyticsPanel({
  analytics,
  onOpenTip,
}: KnowledgeAnalyticsPanelProps) {
  const [mode, setMode] = useState<ChartMode>('overview');
  const [range, setRange] = useState<TimeRange>('7d');

  const updateSeries = useMemo(() => {
    const count = range === '7d' ? 7 : 14;
    return analytics.updateFrequency.slice(-count);
  }, [analytics.updateFrequency, range]);

  const cacheSeries = useMemo(() => {
    const count = range === '7d' ? 7 : 14;
    return analytics.cacheHitTrend.slice(-count);
  }, [analytics.cacheHitTrend, range]);

  const summary = useMemo(() => {
    const totalCreated = updateSeries.reduce((s, p) => s + p.created, 0);
    const totalUpdated = updateSeries.reduce((s, p) => s + p.updated, 0);
    const totalChunksAdded = updateSeries.reduce((s, p) => s + p.chunksDelta, 0);
    const primaryDim =
      [...analytics.dimensionDistribution].sort((a, b) => b.chunks - a.chunks)[0] || null;
    const firstCache = cacheSeries[0];
    const lastCache = cacheSeries[cacheSeries.length - 1];
    const periodCacheDelta =
      firstCache && lastCache
        ? Number((lastCache.hitRate - firstCache.hitRate).toFixed(1))
        : analytics.cacheHitDelta;
    const avgLatency =
      cacheSeries.length > 0
        ? (
            cacheSeries.reduce((s, p) => s + p.avgLatencyMs, 0) / cacheSeries.length
          ).toFixed(1)
        : '10.0';

    return {
      totalCreated,
      totalUpdated,
      totalOps: totalCreated + totalUpdated,
      totalChunksAdded,
      primaryDim,
      periodCacheDelta,
      avgLatency,
      latestHitRate: lastCache?.hitRate ?? analytics.currentCacheHitRate,
      latestQueries: lastCache?.queries ?? 0,
    };
  }, [updateSeries, cacheSeries, analytics]);

  const isSingle = mode !== 'overview';
  const canvasClass = isSingle ? 'kb-chart-canvas tall' : 'kb-chart-canvas';

  const renderUpdateChart = () => (
    <div className="kb-chart-pane">
      <div className="kb-chart-head">
        <h3>文档更新频率</h3>
        <span className="kb-chart-sub mono">
          {range === '7d' ? '近 7 天' : '近 14 天'} · 共 {summary.totalOps} 次变更
        </span>
      </div>
      <div className="kb-chart-legend">
        <span className="kb-legend-item">
          <span className="kb-legend-swatch" style={{ background: '#0969da' }} />
          新增入库
        </span>
        <span className="kb-legend-item">
          <span className="kb-legend-swatch" style={{ background: '#54aeff' }} />
          更新重切片
        </span>
        <span className="kb-legend-item">
          <span className="kb-legend-line" style={{ background: '#1f883d' }} />
          切片增量
        </span>
      </div>
      <div className={canvasClass}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={updateSeries} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid stroke="#eaeef2" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              tick={AXIS_TICK}
              axisLine={{ stroke: '#d8dee4' }}
              tickLine={false}
              interval={range === '14d' && !isSingle ? 1 : 0}
            />
            <YAxis
              yAxisId="left"
              allowDecimals={false}
              tick={AXIS_TICK}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              allowDecimals={false}
              tick={AXIS_TICK}
              axisLine={false}
              tickLine={false}
              width={28}
            />
            <Tooltip content={<UpdateTooltip />} cursor={{ fill: 'rgba(9,105,218,0.06)' }} />
            <Bar
              yAxisId="left"
              dataKey="created"
              stackId="ops"
              name="新增入库"
              fill="#0969da"
              radius={[0, 0, 0, 0]}
              maxBarSize={isSingle ? 32 : 20}
            />
            <Bar
              yAxisId="left"
              dataKey="updated"
              stackId="ops"
              name="更新重切片"
              fill="#54aeff"
              radius={[3, 3, 0, 0]}
              maxBarSize={isSingle ? 32 : 20}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="chunksDelta"
              name="切片增量"
              stroke="#1f883d"
              strokeWidth={2}
              dot={{ r: 3, fill: '#ffffff', stroke: '#1f883d', strokeWidth: 1.5 }}
              activeDot={{ r: 4.5, fill: '#1f883d' }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );

  const renderDimensionChart = () => (
    <div className="kb-chart-pane">
      <div className="kb-chart-head">
        <h3>向量维度分布</h3>
        <span className="kb-chart-sub mono">
          {analytics.dimensionDistribution.length} 类空间 · {analytics.totalVectors} 段向量
        </span>
      </div>
      <div className="kb-chart-legend">
        {analytics.dimensionDistribution.map((b, i) => (
          <span key={b.dimension} className="kb-legend-item">
            <span
              className="kb-legend-swatch"
              style={{ background: DIM_COLORS[i % DIM_COLORS.length] }}
            />
            {b.dimension}
          </span>
        ))}
      </div>
      <div className={canvasClass}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={analytics.dimensionDistribution}
            layout="vertical"
            margin={{ top: 4, right: 16, left: 6, bottom: 0 }}
          >
            <CartesianGrid stroke="#eaeef2" strokeDasharray="3 3" horizontal={false} />
            <XAxis
              type="number"
              tick={AXIS_TICK}
              axisLine={{ stroke: '#d8dee4' }}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="dimension"
              tick={AXIS_TICK}
              axisLine={false}
              tickLine={false}
              width={56}
            />
            <Tooltip content={<DimensionTooltip />} cursor={{ fill: 'rgba(31,35,40,0.04)' }} />
            <Bar
              dataKey="chunks"
              name="向量切片数"
              radius={[0, 4, 4, 0]}
              barSize={isSingle ? 26 : 18}
            >
              {analytics.dimensionDistribution.map((entry, idx) => (
                <Cell key={entry.dimension} fill={DIM_COLORS[idx % DIM_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="kb-dim-list">
        {analytics.dimensionDistribution.map((b, idx) => (
          <div key={b.dimension} className="kb-dim-row">
            <div className="kb-dim-left">
              <span
                className="kb-legend-swatch"
                style={{ background: DIM_COLORS[idx % DIM_COLORS.length] }}
              />
              <span className="od-truncate">
                {b.spaceLabel} · <span className="muted mono">{b.model}</span>
              </span>
            </div>
            <span className="kb-dim-right">
              {b.chunks} 段 · {b.sharePct}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );

  const renderCacheTrendChart = () => (
    <div className="kb-chart-pane">
      <div className="kb-chart-head">
        <h3>缓存命中率变化趋势</h3>
        <span className="kb-chart-sub mono">
          目标基线 85% · 均值耗时 {summary.avgLatency}ms
        </span>
      </div>
      <div className="kb-chart-legend">
        <span className="kb-legend-item">
          <span className="kb-legend-swatch" style={{ background: '#1f883d' }} />
          综合命中率
        </span>
        <span className="kb-legend-item">
          <span className="kb-legend-line" style={{ background: '#0969da' }} />
          语义缓存
        </span>
        {isSingle && (
          <span className="kb-legend-item">
            <span className="kb-legend-line" style={{ background: '#8250df' }} />
            精确 KV
          </span>
        )}
      </div>
      <div className={canvasClass}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={cacheSeries} margin={{ top: 8, right: 10, left: -16, bottom: 0 }}>
            <defs>
              <linearGradient id="kbCacheHitGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#1f883d" stopOpacity={0.22} />
                <stop offset="95%" stopColor="#1f883d" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#eaeef2" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              tick={AXIS_TICK}
              axisLine={{ stroke: '#d8dee4' }}
              tickLine={false}
              interval={range === '14d' && !isSingle ? 1 : 0}
            />
            <YAxis
              domain={[20, 100]}
              tick={AXIS_TICK}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip content={<CacheHitTooltip />} />
            <ReferenceLine
              y={85}
              stroke="#9a6700"
              strokeDasharray="4 4"
              strokeWidth={1}
            />
            <Area
              type="monotone"
              dataKey="hitRate"
              name="综合命中率"
              stroke="#1f883d"
              strokeWidth={2}
              fill="url(#kbCacheHitGrad)"
              dot={{ r: 2.5, fill: '#1f883d' }}
              activeDot={{ r: 4.5, fill: '#1f883d' }}
            />
            <Line
              type="monotone"
              dataKey="semanticHitRate"
              name="语义缓存命中"
              stroke="#0969da"
              strokeWidth={1.75}
              strokeDasharray="4 3"
              dot={false}
              activeDot={{ r: 4, fill: '#0969da' }}
            />
            {isSingle && (
              <Line
                type="monotone"
                dataKey="exactHitRate"
                name="精确 KV 命中"
                stroke="#8250df"
                strokeWidth={1.75}
                dot={false}
                activeDot={{ r: 4, fill: '#8250df' }}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );

  return (
    <section className="box" id="k-analytics">
      <div className="box-h" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div className="od-row" style={{ '--od-gap': '8px' } as CSSProperties}>
          <h2>
            索引与缓存趋势分析
            <ProtoTip
              label="索引与缓存趋势分析"
              text="实时追踪知识库文档的新增与重切片频率、三位一体引擎各向量空间的维度分布（1536/1024/768/3072 维），以及语义与精确缓存命中率的变化趋势。添加文档、重建索引或执行检索后数据会立即刷新。"
              onOpen={onOpenTip}
            />
          </h2>
          <span className="hint">文档变更 · 向量维度 · 缓存命中率</span>
        </div>

        <div className="od-row" style={{ '--od-gap': '8px', flexWrap: 'wrap' } as CSSProperties}>
          <ProtoSeg
            label="图表视图"
            items={
              [
                ['overview', '全景三图'],
                ['updates', '更新频率'],
                ['dimensions', '向量维度'],
                ['cache', '缓存命中率'],
              ] as const
            }
            value={mode}
            onChange={setMode}
          />
          {mode !== 'dimensions' && (
            <ProtoSeg
              label="统计时间窗"
              items={
                [
                  ['7d', '近 7 天'],
                  ['14d', '近 14 天'],
                ] as const
              }
              value={range}
              onChange={setRange}
            />
          )}
        </div>
      </div>

      {/* Summary KPI Strip */}
      <div className="kb-kpi-strip">
        <div className="kb-kpi-item">
          <span className="kb-kpi-lbl">
            文档更新频率（{range === '7d' ? '近 7 天' : '近 14 天'}）
          </span>
          <div className="kb-kpi-val">
            <span className="mono">{summary.totalOps} 次</span>
            <span className="kb-kpi-meta">
              新增 {summary.totalCreated} · 重切片 {summary.totalUpdated} · +{summary.totalChunksAdded}{' '}
              段
            </span>
          </div>
        </div>

        <div className="kb-kpi-item">
          <span className="kb-kpi-lbl">主力向量维度空间</span>
          <div className="kb-kpi-val">
            <span className="mono">{summary.primaryDim?.dimension || '1536 维'}</span>
            <span className="kb-kpi-meta">
              占 {summary.primaryDim?.sharePct ?? 0}% · 共 {analytics.totalVectors} 段活跃向量
            </span>
          </div>
        </div>

        <div className="kb-kpi-item">
          <span className="kb-kpi-lbl">当前综合缓存命中率</span>
          <div className="kb-kpi-val">
            <span className="mono">{summary.latestHitRate.toFixed(1)}%</span>
            <span
              className={`kb-kpi-delta ${summary.periodCacheDelta >= 0 ? 'up' : 'down'}`}
            >
              {summary.periodCacheDelta >= 0 ? '+' : ''}
              {summary.periodCacheDelta.toFixed(1)}% 较期初
            </span>
            <span className="kb-kpi-meta">今日检索 {summary.latestQueries} 次</span>
          </div>
        </div>
      </div>

      {/* Charts Area */}
      {mode === 'overview' ? (
        <div className="kb-chart-grid">
          {renderUpdateChart()}
          {renderDimensionChart()}
          {renderCacheTrendChart()}
        </div>
      ) : mode === 'updates' ? (
        renderUpdateChart()
      ) : mode === 'dimensions' ? (
        renderDimensionChart()
      ) : (
        renderCacheTrendChart()
      )}
    </section>
  );
}
