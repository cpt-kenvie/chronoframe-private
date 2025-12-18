<script lang="ts" setup>
import type { FormSubmitEvent } from '@nuxt/ui'

useHead({
  title: $t('auth.form.signin.title'),
})

const { fetch: fetchUserSession } = useUserSession()
const config = useRuntimeConfig()
const toast = useToast()
const route = useRoute()
const router = useRouter()

const isLoading = ref(false)

type LoginCredentials = {
  email: string
  password: string
}

const isLoginFetchError = (error: unknown): error is { data?: unknown } => {
  return typeof error === 'object' && error !== null && 'data' in error
}

const hasMessage = (value: unknown): value is { message?: unknown } => {
  return typeof value === 'object' && value !== null && 'message' in value
}

const onAuthSubmit = async (event: FormSubmitEvent<LoginCredentials>) => {
  const body = { ...event.data }
  isLoading.value = true
  try {
    await $fetch('/api/login', {
      method: 'POST',
      body,
    })

    await fetchUserSession()
    await router.push(route.query.redirect?.toString() || '/')
  } catch (error) {
    console.error('Login error:', error)

    const description =
      isLoginFetchError(error) &&
      hasMessage(error.data) &&
      typeof error.data.message === 'string'
        ? error.data.message
        : 'An unexpected error occurred. Please try again.'

    toast.add({
      color: 'error',
      title: 'Login Failed',
      description,
    })
  } finally {
    isLoading.value = false
  }
}
</script>

<template>
  <div
    class="w-full min-h-svh flex flex-col items-center justify-center p-4 pb-12"
  >
    <AuthForm
      :title="$t('auth.form.signin.title')"
      :subtitle="$t('auth.form.signin.subtitle', [config.public.app.title])"
      :loading="isLoading"
      :providers="[
        config.public.oauth.github.enabled && {
          icon: 'tabler:brand-github',
          size: 'lg',
          color: 'neutral',
          variant: 'subtle',
          block: true,
          label: 'GitHub',
          to: '/api/auth/github',
          external: true,
        },
      ]"
      @submit="onAuthSubmit"
    />
  </div>
</template>

<style scoped></style>
