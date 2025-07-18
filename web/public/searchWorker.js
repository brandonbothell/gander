self.onmessage = function (e) {
  const { recordings, nicknames, search, isNicknamedOnly, dateRange, requestId } = e.data;

  try {
    const searchLower = search && search.length >= 2 ? search.toLowerCase() : null;

    const filtered = recordings.filter(rec => {
      const nickname = nicknames[rec.filename];

      // 1. Nicknamed filter
      if (isNicknamedOnly && (!nickname || nickname.trim() === '')) {
        return false;
      }

      // 2. Search filter
      if (searchLower) {
        const hasNicknameMatch = nickname && nickname.toLowerCase().includes(searchLower);
        const hasFilenameMatch = rec.filename.toLowerCase().includes(searchLower);

        if (!hasNicknameMatch && !hasFilenameMatch) {
          return false;
        }
      }

      // 3. Date range filter
      if (dateRange.from || dateRange.to) {
        const match = rec.filename.match(/motion_(.+)\.mp4/);
        if (match) {
          const formattedFileDate = match[1].replace(
            /T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/,
            function (_m, h, m2, s, ms) { return 'T' + h + ':' + m2 + ':' + s + '.' + ms + 'Z'; }
          );

          try {
            const fileDateObj = new Date(formattedFileDate);
            const year = fileDateObj.getFullYear();
            const month = String(fileDateObj.getMonth() + 1).padStart(2, '0');
            const day = String(fileDateObj.getDate()).padStart(2, '0');
            const fileDateLocal = year + '-' + month + '-' + day;

            if (dateRange.from && /^\d{4}-\d{2}-\d{2}$/.test(dateRange.from) && fileDateLocal < dateRange.from) {
              return false;
            }
            if (dateRange.to && /^\d{4}-\d{2}-\d{2}$/.test(dateRange.to) && fileDateLocal > dateRange.to) {
              return false;
            }
          } catch (dateError) {
            return false;
          }
        }
      }

      return true;
    });

    // Sort newest first
    filtered.sort(function (a, b) { return b.filename.localeCompare(a.filename); });

    self.postMessage({ filtered: filtered, requestId: requestId });
  } catch (error) {
    self.postMessage({ error: error.message, requestId: requestId });
  }
};
