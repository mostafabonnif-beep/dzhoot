/**
 * Turn an axios/network failure into a message an operator can act on.
 *
 * The admin pages that fetch data were each growing their own copy of this (diagnostics,
 * versions), and the tickets page had none at all — it caught the error and rendered an
 * empty list, so a 401 or a 500 looked exactly like "no tickets yet". One helper makes the
 * failure visible and keeps the wording in the locale dictionary.
 *
 * `pick` follows the dictionary's convention: `pick(ar, en, fr)`.
 */
export type LocalePick = (ar: string, en: string, fr: string) => string;

export function describeApiError(err: unknown, pick: LocalePick): string {
  const error = err as {
    response?: { status?: number; data?: unknown };
    message?: string;
    code?: string;
  };
  const status = error?.response?.status;
  const data = error?.response?.data;

  // The API answers with `{ error }` (and sometimes `{ message }`); show it verbatim when it
  // is there, because it is more specific than anything we can guess.
  let serverMessage = '';
  if (typeof data === 'string') {
    serverMessage = data;
  } else if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    if (typeof record.error === 'string') serverMessage = record.error;
    else if (typeof record.message === 'string') serverMessage = record.message;
  }

  if (status === 401) {
    return pick(
      'انتهت صلاحية الجلسة أو لا تملك صلاحية الوصول (401). أعد تسجيل الدخول ثم حاول مجدداً.',
      'Your session expired or you are not authorized (401). Sign in again and retry.',
      'Votre session a expiré ou vous n’êtes pas autorisé (401). Reconnectez-vous et réessayez.',
    );
  }
  if (status === 403) {
    return pick(
      'لا تملك صلاحية الوصول إلى هذا المورد (403).',
      'You do not have access to this resource (403).',
      'Vous n’avez pas accès à cette ressource (403).',
    );
  }
  if (status === 500 || status === 502 || status === 503 || status === 504) {
    return serverMessage
      ? pick(
          `خطأ في الخادم (${status}): ${serverMessage}`,
          `Server error (${status}): ${serverMessage}`,
          `Erreur serveur (${status}) : ${serverMessage}`,
        )
      : pick(
          `خطأ في الخادم (${status}). أعد المحاولة بعد قليل.`,
          `Server error (${status}). Try again shortly.`,
          `Erreur serveur (${status}). Réessayez bientôt.`,
        );
  }
  if (serverMessage) return serverMessage;
  // Network failures (no response) and anything else: axios says "Network Error" in English,
  // which is not useful to an Arabic or French operator, so prefer the caller's wording.
  return err instanceof Error && error.code !== 'ERR_NETWORK' && error.message
    ? error.message
    : pick(
        'تعذّر الاتصال بالخادم. تحقّق من الشبكة وأعد المحاولة.',
        'Could not reach the server. Check your connection and try again.',
        'Impossible de joindre le serveur. Vérifiez la connexion et réessayez.',
      );
}
