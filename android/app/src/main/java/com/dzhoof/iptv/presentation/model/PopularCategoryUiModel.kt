package com.dzhoof.iptv.presentation.model

data class PopularCategoryUiModel(
    val name: String,
    val channelCount: Int,
    val imageUrl: String?,
    val isFavorite: Boolean
)
