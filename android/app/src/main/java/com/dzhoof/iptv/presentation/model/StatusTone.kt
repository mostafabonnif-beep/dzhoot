package com.dzhoof.iptv.presentation.model

/**
 * Semantic tone for a status line.
 *
 * The ViewModel reports the *meaning* of a status; the UI resolves it to a
 * theme colour. Keeping Compose colours out of state means status text follows
 * the active light/dark scheme automatically and survives a palette change.
 */
enum class StatusTone { NEUTRAL, SUCCESS, ERROR }
