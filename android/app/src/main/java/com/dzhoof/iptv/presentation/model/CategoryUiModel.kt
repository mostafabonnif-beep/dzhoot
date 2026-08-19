package com.dzhoof.iptv.presentation.model

/**
 * UI model representing a category for display in the presentation layer.
 */
data class CategoryUiModel(
    val id: String,
    val name: String,
    val channelCount: Int
)
