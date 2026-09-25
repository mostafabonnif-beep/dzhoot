package com.dzhoof.iptv.data.source.remote

/**
 * Translates between the local Room key used by `playback_positions` and the
 * server's `(contentType, contentId)` pair.
 *
 * The two sides were designed independently and do not agree on a key, which is
 * why a mapping has to exist at all:
 *
 * - live TV is stored locally under the raw channel id (Room has no type column);
 * - VOD is stored under `vod:<contentType>:<contentId>`, the key
 *   `VodPlayerViewModel.progressKey()` builds, so movies and episodes share one
 *   table without colliding with a channel id;
 * - the server stores `contentType` and `contentId` separately, with
 *   `contentType` being one of `live`, `movie`, `series`, `episode`.
 *
 * Anything unrecognised maps to `null` and is skipped rather than guessed: a
 * wrong pairing would resume the wrong stream, which is worse than not syncing.
 * This is the single place the two key spaces are bridged, so it is pure and
 * directly unit-tested.
 */
object WatchProgressContentKey {

    private const val VOD_PREFIX = "vod:"

    /** Server content types this app can resume. */
    private val KNOWN_TYPES = setOf("live", "movie", "series", "episode")

    /**
     * Local `playback_positions.channelId` for a server row, or null when the row
     * cannot be represented locally.
     *
     * A server that starts sending a new content type simply yields null here —
     * the rest of the list still syncs.
     */
    fun localKey(contentType: String?, contentId: String?): String? {
        val type = contentType?.trim()?.lowercase()
        val id = contentId?.trim()
        if (type.isNullOrEmpty() || id.isNullOrEmpty()) return null
        if (type !in KNOWN_TYPES) return null
        return if (type == "live") id else "$VOD_PREFIX$type:$id"
    }

    /**
     * `(contentType, contentId)` for a local key, or null when the key is not a
     * syncable position.
     *
     * A VOD key is only accepted with a known type and a non-empty id, so a
     * malformed `vod:` row is ignored instead of being pushed under a wrong type.
     */
    fun serverKey(localKey: String): Pair<String, String>? {
        val key = localKey.trim()
        if (key.isEmpty()) return null
        if (!key.startsWith(VOD_PREFIX)) {
            // No prefix and no separator: a live channel id.
            return if (key.contains(':')) null else "live" to key
        }
        val parts = key.split(':')
        if (parts.size != 3) return null
        val type = parts[1].lowercase()
        val id = parts[2]
        if (type !in KNOWN_TYPES || type == "live" || id.isEmpty()) return null
        return type to id
    }
}
