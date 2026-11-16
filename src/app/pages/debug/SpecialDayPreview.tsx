import { useState } from 'react'
import { Button } from '@heroui/react'
import { useT } from '../../i18n'
import { useShellStore } from '../../store'
import SpecialDayToastCard from '../../../components/SpecialDayToastCard'
import type { SpecialDayCategory } from '../../../components/SpecialDayToastCard'

interface FixedDay {
  month: number
  day: number
  title: string
  body: string
  tag: string
  icon: string
  category: SpecialDayCategory
}

// Mirrors src-tauri/src/special_day.rs. This is a debug-only gallery, not a second
// source of truth: when a date changes there, update both locale lists.
const FIXED_DAYS_ZH: FixedDay[] = [
  { month: 1, day: 1, title: '元旦', body: '新的一年，也别忘了站起来走走。', tag: '生活节日', icon: '🎊', category: 'life' },
  { month: 3, day: 8, title: '国际妇女节', body: '不被定义，自有光芒。愿你成为自己的风暴，也成为自己的港湾。', tag: '生活节日', icon: '🌸', category: 'life' },
  { month: 4, day: 1, title: '愚人节', body: '认真工作，偶尔也开个无伤大雅的玩笑。', tag: '生活节日', icon: '🃏', category: 'life' },
  { month: 5, day: 1, title: '劳动节', body: '休息也是生产力的一部分，今天也请善待自己。', tag: '生活节日', icon: '🛠️', category: 'life' },
  { month: 5, day: 4, title: '五四青年节', body: '青春无关年龄，在于心底的那份热忱。保持好奇，无畏前行。', tag: '生活节日', icon: '⚡', category: 'life' },
  { month: 6, day: 1, title: '儿童节', body: '心里住着个小孩，工作也会轻松点。', tag: '生活节日', icon: '🎈', category: 'life' },
  { month: 10, day: 1, title: '国庆节', body: '山河无恙，家国安宁。愿你今天也有片刻舒展。', tag: '生活节日', icon: 'flag-cn', category: 'life' },
  { month: 7, day: 7, title: '七七事变', body: '烽火岁月不可忘，山河无恙吾辈强。铭记历史，致敬英雄。', tag: '历史铭记', icon: '🕯️', category: 'history' },
  { month: 8, day: 15, title: '日本投降纪念日', body: '胜利来之不易，历史不容遗忘。正义永存，吾辈当自强。', tag: '历史铭记', icon: '🕊️', category: 'history' },
  { month: 9, day: 3, title: '中国人民抗日战争胜利纪念日', body: '硝烟已散，精神永存。以和平之名，奋进新时代。', tag: '历史铭记', icon: '🎗️', category: 'history' },
  { month: 9, day: 18, title: '九一八事变', body: '警钟长鸣，震慑心魄；勿忘国耻，实干兴邦。', tag: '历史铭记', icon: '🔔', category: 'history' },
  { month: 12, day: 13, title: '南京大屠杀死难者国家公祭日', body: '昭昭前事，惕惕后人。以永不忘却之名，守护和平。', tag: '历史铭记', icon: '🕯️', category: 'history' },
]

const FIXED_DAYS_EN: FixedDay[] = [
  { month: 1, day: 1, title: "New Year's Day", body: "A new year — don't forget to stand up and stretch.", tag: 'Life', icon: '🎊', category: 'life' },
  { month: 3, day: 8, title: "International Women's Day", body: 'Undefined, unstoppable. Be your own storm and your own harbor.', tag: 'Life', icon: '🌸', category: 'life' },
  { month: 4, day: 1, title: "April Fools' Day", body: 'Work hard, joke lightly.', tag: 'Life', icon: '🃏', category: 'life' },
  { month: 5, day: 1, title: 'Labor Day', body: 'Rest is part of the work. Be kind to yourself today.', tag: 'Life', icon: '🛠️', category: 'life' },
  { month: 5, day: 4, title: 'Youth Day', body: 'Youth is a state of mind. Stay curious, keep moving.', tag: 'Life', icon: '⚡', category: 'life' },
  { month: 6, day: 1, title: "Children's Day", body: 'Keep a little wonder at your desk.', tag: 'Life', icon: '🎈', category: 'life' },
  { month: 10, day: 1, title: 'National Day', body: 'Peaceful lands, steady hearts. Take a moment to breathe.', tag: 'Life', icon: 'flag-cn', category: 'life' },
  { month: 7, day: 7, title: 'July 7 Incident', body: 'The fires of war must not be forgotten. Honor the heroes, guard the peace.', tag: 'History', icon: '🕯️', category: 'history' },
  { month: 8, day: 15, title: 'V-J Day', body: 'Victory was hard-won; history must be remembered. Justice endures.', tag: 'History', icon: '🕊️', category: 'history' },
  { month: 9, day: 3, title: 'Victory Day', body: 'The smoke has cleared, but the spirit lives on. In the name of peace, forge ahead.', tag: 'History', icon: '🎗️', category: 'history' },
  { month: 9, day: 18, title: 'Mukden Incident', body: 'Let the alarm ring on. Never forget, and build a stronger tomorrow.', tag: 'History', icon: '🔔', category: 'history' },
  { month: 12, day: 13, title: 'National Memorial Day', body: 'Remember the past, hold fast to peace. We shall never forget.', tag: 'History', icon: '🕯️', category: 'history' },
]

/** Debug-only gallery for every fixed special day, plus both card palettes. */
export function SpecialDayPreview() {
  const t = useT()
  const locale = useShellStore((state) => state.locale)
  const [open, setOpen] = useState(false)
  const days = locale === 'zh-CN' ? FIXED_DAYS_ZH : FIXED_DAYS_EN

  return (
    <section className="ct-debug-panel">
      <div className="ct-debug-panel-head">
        <h2 className="ct-debug-panel-title">{t('debug.specialDayPreview.title')}</h2>
        <div className="ct-debug-special-actions">
          <span className="ct-debug-special-hint">{t('debug.specialDayPreview.hint')}</span>
          <Button size="sm" variant="secondary" onClick={() => setOpen((value) => !value)}>
            {t(open ? 'debug.specialDayPreview.hide' : 'debug.specialDayPreview.show')}
          </Button>
        </div>
      </div>
      {open && (
        <div className="ct-debug-special-grid">
          {days.map((day) => (
            <div className="ct-debug-special-card" key={`${day.month}-${day.day}`}>
              <span className="ct-debug-special-date">
                {locale === 'zh-CN' ? `${day.month} 月 ${day.day} 日` : `${day.month}/${day.day}`}
              </span>
              <SpecialDayToastCard
                title={day.title}
                body={day.body}
                tag={day.tag}
                icon={day.icon}
                category={day.category}
                onClose={() => {}}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
