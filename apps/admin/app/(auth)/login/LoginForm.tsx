'use client'

import { useActionState } from 'react'
import { Button } from '../../../components/ui/Button'
import { Card, Field, inputClasses } from '../../../components/ui/Field'
import { signInAction, type LoginState } from './actions'

/**
 * الفورم **مابيستوردش** أي حاجة من Supabase.
 * كل الاتصال بيحصل جوه Server Action، فالمتصفح مايشوفش مفتاح ولا توكن،
 * ومفيش أي NEXT_PUBLIC_ في المشروع.
 */

const INITIAL: LoginState = { error: null }

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(signInAction, INITIAL)

  return (
    <Card>
      <form action={formAction} className="space-y-3" noValidate>
        <input type="hidden" name="next" value={next} />

        <Field htmlFor="email" label="البريد الإلكتروني">
          <input
            id="email"
            name="email"
            type="email"
            dir="ltr"
            autoComplete="username"
            required
            disabled={pending}
            className={inputClasses}
          />
        </Field>

        <Field htmlFor="password" label="كلمة المرور">
          <input
            id="password"
            name="password"
            type="password"
            dir="ltr"
            autoComplete="current-password"
            required
            disabled={pending}
            className={inputClasses}
          />
        </Field>

        {state.error !== null ? (
          <p role="alert" className="text-xs font-medium text-danger">
            {state.error}
          </p>
        ) : null}

        <Button type="submit" disabled={pending} className="w-full">
          {pending ? 'بيتحقق...' : 'دخول'}
        </Button>
      </form>
    </Card>
  )
}
