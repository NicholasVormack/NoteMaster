import { useCallback, useEffect, useState } from 'react';

/**
 * useFetch - small GET/POST/PUT hook.
 *
 * Differences from the original:
 *   - refetches when the url changes, so search and filter state can live in the
 *     url instead of requiring window.location.reload();
 *   - returns `error` instead of silently leaving `data` null on a failed
 *     request;
 *   - exposes `refetch()` so a row can tell the list that something changed;
 *   - ignores responses that arrive after unmount.
 */
const useFetch = (url, body, TYPE = 'GET') => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [nonce, setNonce] = useState(0);

  const refetch = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setError(null);

      try {
        const options = {
          method: TYPE,
          headers: {
            'content-type': 'application/json',
            'x-auth-token': localStorage.getItem('token'),
          },
        };

        if (TYPE === 'POST' || TYPE === 'PUT') {
          options.body = body;
        }

        const response = await fetch(url, options);
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(payload.msg || `Request failed with status ${response.status}`);
        }

        if (!cancelled) setData(payload);
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError.message);
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();

    return () => {
      cancelled = true;
    };
    // `body` is intentionally excluded: it is the request payload, not a key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, TYPE, nonce]);

  return { data, loading, error, refetch };
};

export default useFetch;
