import { Button } from '@alfalab/core-components/button/esm'
import { Steps } from '@alfalab/core-components/steps/esm'
import { Typography } from '@alfalab/core-components/typography/esm'
import { ArrowRightMIcon } from '@alfalab/icons-glyph/ArrowRightMIcon'
import { ArrowRightUpMIcon } from '@alfalab/icons-glyph/ArrowRightUpMIcon'
import { ClockLineMIcon } from '@alfalab/icons-glyph/ClockLineMIcon'
import { Document1CMIcon } from '@alfalab/icons-glyph/Document1CMIcon'
import { DocumentLinesMIcon } from '@alfalab/icons-glyph/DocumentLinesMIcon'
import { personas, personasOf } from '../demo/personas'
import { LoginFrame } from './LoginFrame'
import { useDemoEnter } from './useDemoEnter'
import styles from './NonClientPage.module.css'

const steps = [
  ['Откройте расчётный счёт', 'Онлайн за один день: ИП — по паспорту, ООО — по документам компании. Можно выбрать бесплатное обслуживание.'],
  ['Проводите обороты через счёт', 'Эквайринг, оплаты от покупателей, платежи поставщикам. Чем больше оборотов в Альфе, тем выше лимит и ниже ставка.'],
  ['Через 3 месяца — предложение', 'Кабинет сам рассчитает кредит по вашим оборотам и объяснит, почему сумма такая и как получить больше.'],
  ['Нужно раньше?', 'После открытия счёта загрузите выписку из другого банка в формате 1С — она тоже учитывается в расчёте.'],
]

// Не клиент Альфы: кредит в кабинете доступен только со счётом — показываем путь, а не анкету.
export function NonClientPage() {
  const { isBusy, errorFor, enter } = useDemoEnter()
  // Как выглядит кабинет, когда счёт уже есть, — показываем на главном сценарии (данные из demo/personas.ts).
  const example = personas.find(p => p.primary) ?? personasOf('client')[0]
  const error = errorFor('nonclient', example.login)
  return <LoginFrame
    eyebrow="Ещё не клиент"
    title={<>Сначала счёт —<br />потом кредит</>}
    lead="Кредитный кабинет считает предложение по реальным оборотам бизнеса. Без счёта в Альфе опереться не на что, поэтому путь начинается с него."
    points={[
      { icon: DocumentLinesMIcon, title: 'Без справок о выручке', text: 'Обороты банк видит по счёту сам — анкета короткая' },
      { icon: ClockLineMIcon, title: 'Без визита в офис', text: 'Счёт, заявка, подпись договора — всё онлайн' },
      { icon: Document1CMIcon, title: 'Обороты в другом банке тоже считаются', text: 'Загрузите выписку 1С — лимит пересчитается' },
    ]}
    footnote="Демо-стенд: все компании и операции синтетические."
    back={{ to: '/login', label: 'К выбору профиля' }}
  >
    <section className={styles.card}>
      <div className={styles.eyebrow}>Ваш путь к кредиту</div>
      <Typography.Title tag="h2" view="medium" font="system" weight="bold" className={styles.title}>Четыре шага</Typography.Title>
      <Steps isVerticalAlign ordered interactive={false} activeStep={1} isMarkCompletedSteps={false} minSpaceBetweenSteps={24} className={styles.steps}>
        {steps.map(([title, text]) => <div key={title} className={styles.step}>
          <b>{title}</b>
          <span>{text}</span>
        </div>)}
      </Steps>
      <div className={styles.actions}>
        <Button view="accent" size={48} loading={isBusy('nonclient', example.login)} rightAddons={<ArrowRightMIcon />}
          onClick={() => enter(example, 'nonclient')}>
          Посмотреть кабинет клиента
        </Button>
        <Button view="secondary" size={48} href="https://alfabank.ru/sme/" target="_blank" rel="noreferrer" rightAddons={<ArrowRightUpMIcon />}>
          Открыть счёт на сайте банка
        </Button>
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <p className={styles.note}>
        Демо: войдём под клиентом «{example.subtitle.split(' · ')[0]}» — так кабинет выглядит, когда обороты уже идут через счёт.
        Сайт банка откроется в новой вкладке.
      </p>
    </section>
  </LoginFrame>
}
