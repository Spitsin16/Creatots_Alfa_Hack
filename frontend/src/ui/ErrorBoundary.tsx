import { Component, ErrorInfo, ReactNode } from 'react'
import { Button } from '@alfalab/core-components/button/esm'
import { ExclamationCircleMIcon } from '@alfalab/icons-glyph/ExclamationCircleMIcon'
import styles from './ErrorBoundary.module.css'

type Props = {
  children: ReactNode
  /** Смена ключа сбрасывает ошибку (оболочка передаёт адрес страницы) */
  resetKey?: string
  /** Компактный вид — для отдельного виджета внутри экрана, а не всей страницы */
  compact?: boolean
}
type State = { error: Error | null }

/**
 * Ловит падение рендера и показывает дружелюбную ошибку вместо белого экрана.
 * Оболочка кабинета уже оборачивает каждую страницу; внутри экрана можно обернуть
 * отдельный рискованный виджет (график, сторонний компонент) с compact.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('Экран упал при отрисовке:', error, info.componentStack)
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    const { compact } = this.props
    return <div className={compact ? styles.compact : styles.page} role="alert">
      <div className={styles.icon} aria-hidden><ExclamationCircleMIcon /></div>
      <div className={styles.title}>{compact ? 'Этот блок не загрузился' : 'Что-то пошло не так'}</div>
      <div className={styles.text}>
        {compact ? 'Остальная страница работает. Попробуйте обновить блок.' : 'Страница не смогла отобразиться. Ваши данные в порядке — обновите страницу, чтобы продолжить.'}
      </div>
      <div className={styles.actions}>
        {compact
          ? <Button view="secondary" size={40} onClick={() => this.setState({ error: null })}>Повторить</Button>
          : <>
            <Button view="primary" size={48} onClick={() => window.location.reload()}>Обновить страницу</Button>
            <Button view="secondary" size={48} href="/">На главную</Button>
          </>}
      </div>
      <details className={styles.details}><summary>Подробности для разработчика</summary><code>{this.state.error.message}</code></details>
    </div>
  }
}
