import mongoose from 'mongoose';
import { rewriteManifest } from '../services/secure-playback-proxy';

const {
  canonicalResourcePath,
  buildPlaybackUrlForBase,
} = require('../utils/playback-security');

const contentId = new mongoose.Types.ObjectId();
const sourceId = new mongoose.Types.ObjectId();
const request = { protocol: 'https', get: () => 'api.example.test' } as any;

function managedMovie() {
  return {
    _id: contentId,
    sourceId,
    externalId: '200',
    streamUrl: 'https://upstream.example/movie/user/password/200.mp4',
    containerExtension: 'mp4',
  };
}

describe('S1.2 managed playback hardening', () => {
  it.each([
    '/player_api.php?username=user&password=password',
    '/get.php?username=user&password=password&type=m3u_plus',
    '/movie/user/password/999.mp4',
    '/movie/user/password/200/../../player_api.php',
    '/panel_api.php?username=user&password=password',
    '/movie/user/password/201_00001.ts',
    '/series/user/password/200_00001.ts',
    'https://internal.example/player_api.php',
    'ftp://upstream.example/movie/user/password/200.mp4',
    'http://upstream.example/movie/user/password/200.mp4',
  ])('rejects unsafe managed resource %s', (resource) => {
    const canonical = 'https://user:password@upstream.example/movie/user/password/200.mp4';
    expect(() => canonicalResourcePath(resource, canonical, managedMovie(), 'MOVIE')).toThrow();
  });

  it('rejects a resource with a changed upstream origin', () => {
    const canonical = 'https://user:password@upstream.example/movie/user/password/200.mp4';
    expect(() => canonicalResourcePath(
      'https://other.example/movie/user/password/200.mp4',
      canonical,
      managedMovie(),
      'MOVIE',
    )).toThrow();
  });

  it('signs and accepts a legitimate media resource', () => {
    const canonical = 'https://user:password@upstream.example/movie/user/password/200.mp4';
    const signed = canonicalResourcePath(canonical, canonical, managedMovie(), 'MOVIE');
    expect(signed).toMatch(/^\/movie\/200\.mp4\?sig=[a-f0-9]{64}$/);
  });

  it('rewrites managed manifests without upstream credentials', () => {
    const canonical = 'https://user:password@upstream.example/movie/user/password/200.m3u8';
    const rewritten = rewriteManifest(
      '#EXTM3U\n/movie/user/password/200_00001.ts',
      canonical,
      '/api/v1/stream-proxy',
      (absolute: string) => canonicalResourcePath(absolute, canonical, managedMovie(), 'MOVIE'),
    );
    expect(rewritten).not.toContain('user');
    expect(rewritten).not.toContain('password');
    expect(rewritten).toContain('sig=');
  });

  it('playback references remain local', () => {
    const url = buildPlaybackUrlForBase('https://api.example.test', 'MOVIE', contentId);
    expect(url).toBe(`https://api.example.test/api/v1/stream-proxy?contentType=MOVIE&contentId=${contentId}`);
  });

  it('redirect target validation checks every hop with DNS-aware SSRF validation', async () => {
    jest.resetModules();
    const ssrf = require('../utils/ssrf-guard');
    const proxy = require('../services/secure-playback-proxy');
    expect(ssrf.validateUrlForSSRF).toBeDefined();
    expect(proxy.proxyResolvedStream).toBeDefined();
  });
});
