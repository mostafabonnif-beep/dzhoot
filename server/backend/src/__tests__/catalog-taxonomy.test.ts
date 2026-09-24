import {
  mapGroupToCategory,
  TAXONOMY_CATEGORIES,
} from '../services/catalog-taxonomy-service';

describe('mapGroupToCategory', () => {
  it('maps the raw groups observed in the audit to the right sections', () => {
    expect(mapGroupToCategory('RADIO MIX')).toBe('راديو');
    expect(mapGroupToCategory('SPORT HD')).toBe('رياضة');
    expect(mapGroupToCategory('BEIN SPORT HD')).toBe('رياضة');
    expect(mapGroupToCategory('CANAL+ SPORT')).toBe('رياضة'); // sport beats french
    expect(mapGroupToCategory('24/7 KIDS')).toBe('أطفال');
    expect(mapGroupToCategory('FRANCE 24 ENGLISH')).toBe('إخبارية');
    expect(mapGroupToCategory('SKY NEWS')).toBe('إخبارية');
    expect(mapGroupToCategory('OSN MOVIES HD')).toBe('أفلام');
    expect(mapGroupToCategory('SHAHID VIP شاهد')).toBe('مسلسلات');
    expect(mapGroupToCategory('TURK DRAMA')).toBe('مسلسلات');
    expect(mapGroupToCategory('MBC HD')).toBe('مباشر عربي');
    expect(mapGroupToCategory('ALGERIE VIP')).toBe('مباشر عربي');
    expect(mapGroupToCategory('FRANCE VIP')).toBe('فرنسي');
    expect(mapGroupToCategory('CANAL+ AFRICA')).toBe('فرنسي');
    expect(mapGroupToCategory('GENERAL HD')).toBe('متنوع');
    expect(mapGroupToCategory('AFRICA VIP HD')).toBe('متنوع');
    expect(mapGroupToCategory('')).toBe('متنوع');
  });

  it('exposes exactly the approved eight sections plus fallback', () => {
    expect(TAXONOMY_CATEGORIES).toHaveLength(9);
    expect(TAXONOMY_CATEGORIES.filter((c) => c !== 'متنوع')).toHaveLength(8);
  });
});
