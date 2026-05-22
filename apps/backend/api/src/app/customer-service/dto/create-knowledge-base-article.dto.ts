import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ArticleStatus } from '../entities/knowledge-base-article.entity';

export class CreateKnowledgeBaseArticleDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  content: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsEnum(ArticleStatus)
  @IsOptional()
  status?: ArticleStatus;
}