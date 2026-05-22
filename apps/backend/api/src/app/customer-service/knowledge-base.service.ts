import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KnowledgeBaseArticle, ArticleStatus } from './entities/knowledge-base-article.entity';
import { CreateKnowledgeBaseArticleDto } from './dto/create-knowledge-base-article.dto';
import { UpdateKnowledgeBaseArticleDto } from './dto/update-knowledge-base-article.dto';

@Injectable()
export class KnowledgeBaseService {
  constructor(
    @InjectRepository(KnowledgeBaseArticle)
    private readonly articleRepository: Repository<KnowledgeBaseArticle>,
  ) {}


  async create(createDto: CreateKnowledgeBaseArticleDto, organizationId: string): Promise<KnowledgeBaseArticle> {
    const article = this.articleRepository.create({ ...createDto, organizationId });
    return this.articleRepository.save(article);
  }


  async findAllForOrg(organizationId: string): Promise<KnowledgeBaseArticle[]> {
    return this.articleRepository.find({ where: { organizationId } });
  }


  async findAllPublished(organizationId: string): Promise<KnowledgeBaseArticle[]> {
    return this.articleRepository.find({
      where: { organizationId, status: ArticleStatus.PUBLISHED },
      select: ['id', 'title', 'category', 'updatedAt'],
    });
  }
  

  async findOnePublished(id: string, organizationId: string): Promise<KnowledgeBaseArticle> {
      const article = await this.articleRepository.findOneBy({ id, organizationId, status: ArticleStatus.PUBLISHED });
      if (!article) throw new NotFoundException('Artículo no encontrado o no está publicado.');
      return article;
  }


  async update(id: string, updateDto: UpdateKnowledgeBaseArticleDto, organizationId: string): Promise<KnowledgeBaseArticle> {
    const article = await this.articleRepository.findOneBy({ id, organizationId });
    if (!article) throw new NotFoundException('Artículo no encontrado.');
    
    Object.assign(article, updateDto);
    return this.articleRepository.save(article);
  }
}