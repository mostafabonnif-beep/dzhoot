const {
  addSearchFilter,
  isValidObjectId,
  parsePagination,
} = require('./catalog-helpers');

describe('catalog route helpers', () => {
  it('bounds invalid and oversized pagination values', () => {
    expect(parsePagination({ page: '-4', limit: '9999' })).toEqual({
      page: 1,
      limit: 100,
      skip: 0,
    });
    expect(parsePagination({ page: '3', limit: '24' })).toEqual({
      page: 3,
      limit: 24,
      skip: 48,
    });
  });

  it('escapes regex metacharacters in search input', () => {
    const query = {};
    addSearchFilter(query, 'news.*(ar)');
    expect(query.title.$regex).toBe('news\\.\\*\\(ar\\)');
    expect(query.title.$options).toBe('i');
  });

  it('accepts only valid Mongo object ids', () => {
    expect(isValidObjectId('507f1f77bcf86cd799439011')).toBe(true);
    expect(isValidObjectId('not-an-id')).toBe(false);
  });
});
