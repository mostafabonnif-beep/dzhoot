package com.dzhoof.iptv.data.source.local.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Room entity representing a channel in the local database.
 * 
 * This entity stores all channel information including metadata from M3U playlists
 * and supports efficient querying through indexed columns.
 */
@Entity(
    tableName = "channels",
    indices = [
        Index(value = ["categoryId"]),
        Index(value = ["isActive"]),
        Index(value = ["name"])
    ]
)
data class ChannelEntity(
    @PrimaryKey
    val id: String,
    
    val name: String,
    
    val streamUrl: String,
    
    val logoUrl: String?,
    
    val categoryId: String,
    
    val language: String?,
    
    val country: String?,
    
    val groupTitle: String?,

    /** Supplier sort order within its group (curated channel order). */
    val order: Int = 0,
    
    val tvgId: String?,
    
    val tvgName: String?,
    
    /** Catch-up capability ("append" / "timeshift" / …), null when unsupported. */
    val catchupType: String? = null,
    
    /** Catch-up history window in days (null = server default). */
    val catchupDays: Int? = null,
    
    val isActive: Boolean = true,
    
    val lastUpdated: Long = System.currentTimeMillis()
)
