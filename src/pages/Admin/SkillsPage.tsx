// 技能注册（骨架，M5 §F + skill_registry）
// skill_registry：可插拔能力注册表，被 M5 创作节点 / M6 电商节点挂载。
import { Boxes, Plus } from 'lucide-react';
import { PageHeader, SectionCard, Placeholder } from '@/components/skeleton';

export default function SkillsPage() {
  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="技能注册"
        subtitle="skill_registry · 可插拔能力注册表（M5 创作节点 / M6 电商节点共享挂载）"
        phase={{ status: 'planning', label: 'Phase 4' }}
        icon={<Boxes className="size-5" />}
        actions={
          <button className="flex items-center gap-1.5 rounded-2xl bg-emerald-500 px-3 py-2 text-sm font-medium text-black hover:bg-emerald-400 transition-colors">
            <Plus className="size-4" /> 注册技能
          </button>
        }
      />

      <SectionCard
        title="skill_registry"
        hint="key / name / stage / adapter / params / enabled / cost_credits"
      >
        <Placeholder
          label="技能卡片：阶段分组（idea / script / storyboard / video / episode / 电商 8 节点）"
          note="M5: brainstorm, screenwriter, comic_layout, video_gen, publish_agent；M6: product_writer 等 8 个"
          height="h-56"
        />
      </SectionCard>
    </div>
  );
}
