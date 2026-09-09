package com.dzhoof.iptv.data.repository

import com.dzhoof.iptv.data.source.local.dao.ChannelPrefsDao
import com.dzhoof.iptv.data.source.local.entity.ChannelPrefsEntity
import com.dzhoof.iptv.di.IoDispatcher
import com.dzhoof.iptv.domain.model.ChannelPrefs
import com.dzhoof.iptv.domain.repository.ChannelPrefsRepository
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Room-backed [ChannelPrefsRepository]. Keeps a row per channel only while at
 * least one flag is set — clearing the last flag removes the row, so the prefs
 * table never fills with all-default rows as channels are toggled over time.
 */
@Singleton
class ChannelPrefsRepositoryImpl @Inject constructor(
    private val dao: ChannelPrefsDao,
    @IoDispatcher private val dispatcher: CoroutineDispatcher
) : ChannelPrefsRepository {

    override fun observeHiddenIds(): Flow<Set<String>> =
        dao.observeHiddenIds()
            .map { ids -> ids.toSet() }
            .distinctUntilChanged()
            .flowOn(dispatcher)

    override fun observeLockedIds(): Flow<Set<String>> =
        dao.observeLockedIds()
            .map { ids -> ids.toSet() }
            .distinctUntilChanged()
            .flowOn(dispatcher)

    override fun observePrefs(): Flow<Map<String, ChannelPrefs>> =
        dao.observeAll()
            .map { rows ->
                rows.associate { row ->
                    row.channelId to row.toDomain()
                }
            }
            .distinctUntilChanged()
            .flowOn(dispatcher)

    override suspend fun setHidden(channelId: String, hidden: Boolean) = withContext(dispatcher) {
        val current = dao.get(channelId)
        val locked = current?.locked ?: false
        if (hidden || locked) {
            dao.upsert(ChannelPrefsEntity(channelId = channelId, hidden = hidden, locked = locked))
        } else {
            // No flag left set — drop the row instead of storing all-defaults.
            dao.delete(channelId)
        }
    }

    override suspend fun setLocked(channelId: String, locked: Boolean) = withContext(dispatcher) {
        val current = dao.get(channelId)
        val hidden = current?.hidden ?: false
        if (locked || hidden) {
            dao.upsert(ChannelPrefsEntity(channelId = channelId, hidden = hidden, locked = locked))
        } else {
            dao.delete(channelId)
        }
    }

    override suspend fun isHidden(channelId: String): Boolean = withContext(dispatcher) {
        dao.get(channelId)?.hidden ?: false
    }

    override suspend fun isLocked(channelId: String): Boolean = withContext(dispatcher) {
        dao.get(channelId)?.locked ?: false
    }
}

private fun ChannelPrefsEntity.toDomain(): ChannelPrefs =
    ChannelPrefs(channelId = channelId, hidden = hidden, locked = locked)
