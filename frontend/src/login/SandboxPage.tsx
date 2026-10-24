import { useNavigate } from 'react-router'
import { DocumentLinesMIcon } from '@alfalab/icons-glyph/DocumentLinesMIcon'
import { SlidersMIcon } from '@alfalab/icons-glyph/SlidersMIcon'
import { UserMIcon } from '@alfalab/icons-glyph/UserMIcon'
import { useAuth } from '../auth'
import { Sandbox } from '../client/Sandbox'
import { LoginFrame } from './LoginFrame'

// Песочница проверяющего: герой объясняет, что происходит, справа — пошаговая форма (client/Sandbox.tsx).
export function SandboxPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  return <LoginFrame
    eyebrow="Песочница проверяющего"
    title={<>Создайте<br />своего клиента</>}
    lead="Здесь вы играете банк и источники данных: задаёте, что о бизнесе знают Альфа, ФНС и БКИ. Сам клиент выручку и долги не вводит — анкета у него обычная."
    points={[
      { icon: SlidersMIcon, title: 'Задайте параметры', text: 'Форма и возраст бизнеса, выручка, сезонность, кредиты, кредитная история, налоги' },
      { icon: DocumentLinesMIcon, title: 'Данные построятся сами', text: 'Операции по счёту за год (или с открытия, если бизнес моложе), ответы ФНС и БКИ — всё синтетическое' },
      { icon: UserMIcon, title: 'Войдите под клиентом', text: 'Анкета, предложение с объяснением, заявка — решение считает тот же движок, что и для готовых профилей' },
    ]}
    footnote="Новый клиент появляется на стенде сразу и остаётся на экране входа в этом браузере. Пароль — demo, код подписи — 0000."
    back={{ to: '/login', label: 'К выбору профиля' }}
  >
    <Sandbox onLogin={token => { login(token); navigate('/', { replace: true }) }} />
  </LoginFrame>
}
