import { useEffect, useState } from 'react';

/**
 * False until React has attached to the page. Credential forms keep their submit button disabled until then, so an early click
 * can never trigger the browser's native GET submit (which would put the password in the URL).
 */
export function useHydrated() {
  const [h, setH] = useState(false);
  useEffect(() => setH(true), []);
  return h;
}
