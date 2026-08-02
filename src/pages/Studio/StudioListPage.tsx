// 创作工作室 · 项目列表（骨架，M5 / Phase 4）
// projects: title / type(story|commerce|custom) / status / current_stage(idea|script|storyboard|video|episode)
import { FolderPlus, Plus, LayoutGrid } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PageHeader, SectionCard, Placeholder, PhaseBadge, cn } from '@/components/skeleton';

const STAGE_LABEL: Record<string, string> = {
  idea: '点子孵化',
  script: '剧本',
  storyboard: '分镜',
  video: '视频',
  episode: '剧集',
};

// 骨架期：用占位数据展示列表形态；真实数据经 GET /api/studio/projects。
const SAMPLE = [
  { id: '1', title: '东方古典美人', type: 'story', status: 'ready', stage: 'storyboard' },
  { id: '2', title: '赛博长安', type: 'story', status: 'planning', stage: 'script' },
  { id: '3', title: '非遗文创店', type: 'commerce', status: 'planning', stage: 'idea' },
];

export default function StudioListPage() {
  const navigate = useNavigate();

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <PageHeader
        title="创作项目"
        subtitle="M5 创意生产流水线 · 点子 → 剧本 → 分镜 → 视频 → 剧集"
        phase={{ status: 'building', label: 'Phase 4' }}
        icon={<LayoutGrid className="size-5" />}
        actions={
          <button className="flex items-center gap-1.5 rounded-2xl bg-emerald-500 px-3 py-2 text-sm font-medium text-black hover:bg-emerald-400 transition-colors">
            <Plus className="size-4" /> 新建项目
          </button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SAMPLE.map((p) => (
          <button
            key={p.id}
            onClick={() => navigate(`/studio/${p.id}`)}
            className="group rounded-3xl border border-zinc-800 bg-zinc-900/50 p-5 text-left transition-all duration-300 hover:border-emerald-500/40 hover:bg-zinc-900"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-500">{p.type === 'commerce' ? '电商型' : '故事型'}</span>
              <PhaseBadge status={p.status === 'ready' ? 'ready' : 'planning'} />
            </div>
            <h3 className="mt-3 text-base font-semibold text-white group-hover:text-emerald-300 transition-colors">
              {p.title}
            </h3>
            <div className="mt-4 flex items-center justify-between">
              <span className="text-xs text-zinc-500">
                当前阶段：<span className="text-zinc-300">{STAGE_LABEL[p.stage]}</span>
              </span>
              <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400">进入 →</span>
            </div>
          </button>
        ))}

        {/* 新建卡片 */}
        <button
          onClick={() => navigate('/studio/new')}
          className={cn(
            'flex flex-col items-center justify-center gap-2 rounded-3xl border border-dashed border-zinc-700/80 bg-zinc-900/30 p-5 text-center',
            'hover:border-emerald-500/40 hover:bg-zinc-900/50 transition-colors',
          )}
        >
          <div className="flex size-10 items-center justify-center rounded-2xl bg-zinc-800/80 text-emerald-400">
            <FolderPlus className="size-5" />
          </div>
          <span className="text-sm font-medium text-zinc-300">新建项目</span>
        </button>
      </div>

      <SectionCard title="项目表结构" hint="projects" className="opacity-80">
        <Placeholder
          label="真实列表经 GET /api/studio/projects（按 owner_id + updated_at 排序）"
          note="字段：title / type / status / current_stage"
          height="h-20"
        />
      </SectionCard>
    </div>
  );
}
