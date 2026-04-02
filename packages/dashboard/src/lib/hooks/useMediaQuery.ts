import { useCallback, useLayoutEffect, useState } from 'react';

type UseMediaQueryOptions = {
  defaultValue?: boolean;
  initializeWithValue?: boolean;
};

const IS_SERVER = typeof window === 'undefined';

export function useMediaQuery(
  query: string,
  { defaultValue = false, initializeWithValue = true }: UseMediaQueryOptions = {}
): boolean {
  const getMatches = useCallback(
    (nextQuery: string): boolean => {
      if (IS_SERVER) {
        return defaultValue;
      }
      return window.matchMedia(nextQuery).matches;
    },
    [defaultValue]
  );

  const [matches, setMatches] = useState<boolean>(() => {
    if (initializeWithValue) {
      return getMatches(query);
    }
    return defaultValue;
  });

  const handleChange = useCallback(() => {
    setMatches(getMatches(query));
  }, [getMatches, query]);

  useLayoutEffect(() => {
    const matchMedia = window.matchMedia(query);

    handleChange();

    if (matchMedia.addListener) {
      matchMedia.addListener(handleChange);
    } else {
      matchMedia.addEventListener('change', handleChange);
    }

    return () => {
      if (matchMedia.removeListener) {
        matchMedia.removeListener(handleChange);
      } else {
        matchMedia.removeEventListener('change', handleChange);
      }
    };
  }, [handleChange, query]);

  return matches;
}
