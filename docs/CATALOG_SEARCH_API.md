# Unified Catalog Search API

## Endpoint

`GET /api/v1/catalog/search?q=<query>`

The endpoint is intended for authorized DZ HOOF catalog discovery. It preserves the existing `channels`, `movies`, and `series` arrays and adds `programs` for current, future, and recently finished EPG programmes.

## Response

```json
{
  "success": true,
  "data": {
    "channels": [
      {
        "_id": "channel-id",
        "type": "LIVE",
        "name": "Example Channel",
        "logo": "https://example.invalid/logo.png",
        "group": "News"
      }
    ],
    "movies": [
      {
        "_id": "movie-id",
        "type": "MOVIE",
        "name": "Example Movie",
        "poster": "https://example.invalid/poster.jpg",
        "category": "Drama"
      }
    ],
    "series": [
      {
        "_id": "series-id",
        "type": "SERIES",
        "name": "Example Series",
        "poster": "https://example.invalid/poster.jpg",
        "category": "Drama"
      }
    ],
    "programs": [
      {
        "_id": "program-id",
        "type": "PROGRAM",
        "name": "Example Programme",
        "description": "Programme description",
        "category": "News",
        "channelEpgId": "channel-epg-id",
        "startTime": "2026-08-15T12:00:00.000Z",
        "endTime": "2026-08-15T13:00:00.000Z",
        "icon": "https://example.invalid/program.png",
        "language": "ar",
        "catchupAvailable": false
      }
    ]
  }
}
```

## Search behaviour

The query is trimmed and limited to 500 characters. Empty queries return empty arrays. Channel matches search `channelName` and `channelGroup`; movie matches search `title` and `category`; series matches search `title`, `category`, and `genre`; programme matches search `title`, `category`, and `description`.

Programmes remain discoverable until two hours after `endTime`, which supports a short catch-up discovery window without returning stale EPG data indefinitely. Playback authorization remains a separate operation and no stream URL is returned by this discovery endpoint.

## Client compatibility

Clients that only read `channels`, `movies`, and `series` remain compatible. New clients should treat all four arrays as optional-empty collections and use the `type` field for analytics or navigation decisions.
